"""Streaming chat and conversation API routes."""

import json
import logging
from datetime import datetime
from typing import Iterator
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.agent import RetrievalAgent
from app.auth.factory import get_auth_provider
from app.config import get_settings
from app.db.models import Conversation, Message, User
from app.db.session import get_db

try:
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
except ImportError:
    raise

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])
bearer = HTTPBearer(auto_error=False)


async def current_chat_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> UUID:
    """Resolve and provision the current request user."""
    user_id = UUID(get_auth_provider().get_user_id(credentials))
    if db.get(User, user_id) is None:
        db.add(User(id=user_id))
        db.commit()
    return user_id


class ChatRequest(BaseModel):
    """Request payload for chat."""

    message: str
    conversation_id: UUID | None = None


def _event(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sources(results: list[dict[str, object]]) -> list[dict[str, object]]:
    return [
        {"filename": item["filename"], "page": item["page_number"], "snippet": str(item["content"])[:500]}
        for item in results
    ]


@router.post("/chat")
def chat(payload: ChatRequest, user_id: UUID = Depends(current_chat_user), db: Session = Depends(get_db)) -> StreamingResponse:
    """Stream a grounded answer and persist the conversation."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        return StreamingResponse(_single_error("ANTHROPIC_API_KEY is not configured."), media_type="text/event-stream")

    conversation = None
    if payload.conversation_id:
        conversation = db.scalar(select(Conversation).where(Conversation.id == payload.conversation_id, Conversation.user_id == user_id))
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = Conversation(id=uuid4(), user_id=user_id, title=payload.message.strip()[:60] or "New conversation")
        db.add(conversation)
        db.flush()

    db.add(Message(conversation_id=conversation.id, role="user", content=payload.message))
    db.commit()
    history_rows = db.scalars(
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Message.conversation_id == conversation.id, Conversation.user_id == user_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(settings.chat_history_limit)
    ).all()
    history_rows = list(reversed(history_rows))[:-1]
    history = [{"role": row.role, "content": row.content} for row in history_rows]

    def generate() -> Iterator[str]:
        assistant_text = ""
        try:
            agent = RetrievalAgent()
            for token in agent.answer_stream(user_id, payload.message, history):
                assistant_text += token
                yield _event("token", {"text": token})
            sources = _sources(getattr(agent, "sources", []))
            yield _event("sources", sources)
            yield _event("done", {"conversation_id": str(conversation.id), "sources": sources})
            db.add(Message(conversation_id=conversation.id, role="assistant", content=assistant_text, sources=sources))
            db.commit()
        except Exception as exc:
            logger.exception("Chat request failed for user %s", user_id)
            yield _event("error", {"message": _safe_error(exc)})

    return StreamingResponse(generate(), media_type="text/event-stream")


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, anthropic.APIError):
        return "Anthropic API request failed. Please try again later."
    return str(exc) or "Chat request failed."


def _single_error(message: str) -> Iterator[str]:
    yield _event("error", {"message": message})
    yield _event("done", {})


@router.get("/conversations")
def list_conversations(user_id: UUID = Depends(current_chat_user), db: Session = Depends(get_db)) -> list[dict[str, object]]:
    """List conversations owned by the current user."""
    conversations = db.scalars(select(Conversation).where(Conversation.user_id == user_id).order_by(Conversation.created_at.desc())).all()
    return [{"id": str(item.id), "title": item.title, "created_at": item.created_at.isoformat()} for item in conversations]


@router.get("/conversations/{conversation_id}")
def conversation_messages(conversation_id: UUID, user_id: UUID = Depends(current_chat_user), db: Session = Depends(get_db)) -> list[dict[str, object]]:
    """Return messages in an owned conversation."""
    conversation = db.scalar(select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id))
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = db.scalars(select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at, Message.id)).all()
    return [{"id": str(item.id), "role": item.role, "content": item.content, "sources": item.sources, "created_at": item.created_at.isoformat()} for item in messages]


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: UUID, user_id: UUID = Depends(current_chat_user), db: Session = Depends(get_db)) -> None:
    """Delete an owned conversation."""
    conversation = db.scalar(select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id))
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(conversation)
    db.commit()


import anthropic
