"""Streaming chat and conversation API routes."""

import json
import logging
import time
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
from app.db.models import Conversation, Message, Unit, User
from app.db.session import get_db
from app.usage import check_limit, count_message, effective_plan, ensure_plan, documents_used

try:
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
except ImportError:
    raise

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])
bearer = HTTPBearer(auto_error=False)


async def current_chat_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> UUID:
    """Resolve and provision the current request user."""
    provider = get_auth_provider()
    claims = provider.get_claims(credentials)
    user_id = UUID(provider.get_user_id(credentials))
    if db.get(User, user_id) is None:
        db.add(User(id=user_id, email=str(claims.get("email")) if claims.get("email") else None))
        try:
            db.commit()
        except Exception:
            db.rollback()
            user = db.get(User, user_id)
            if user is None:
                raise
            if user.email is None and claims.get("email"):
                user.email = str(claims["email"])
                db.commit()
    return user_id


class ChatRequest(BaseModel):
    """Request payload for chat."""

    message: str
    conversation_id: UUID | None = None
    unit_id: UUID


def _event(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sources(results: list[dict[str, object]]) -> list[dict[str, object]]:
    sources = []
    seen = set()
    for item in results:
        key = (str(item["filename"]), item["page_number"])
        if key in seen:
            continue
        seen.add(key)
        sources.append({
            "filename": item["filename"],
            "page": item["page_number"],
            "snippet": str(item["content"])[:200],
        })
    return sources


@router.post("/chat")
def chat(payload: ChatRequest, user_id: UUID = Depends(current_chat_user), db: Session = Depends(get_db)) -> StreamingResponse:
    """Stream a grounded answer and persist the conversation."""
    settings = get_settings()
    unit = db.scalar(select(Unit).where(Unit.id == payload.unit_id, Unit.user_id == user_id))
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    try:
        check_limit(db, user_id, "messages")
    except HTTPException as exc:
        payload_data = exc.detail if isinstance(exc.detail, dict) else {"code": "limit_reached", "limit": "messages", "message": str(exc.detail)}
        return StreamingResponse(iter([_event("error", payload_data), _event("done", {"conversation_id": ""})]), media_type="text/event-stream", status_code=402)
    if not settings.anthropic_api_key:
        return StreamingResponse(_single_error("ANTHROPIC_API_KEY is not configured."), media_type="text/event-stream")

    conversation = None
    if payload.conversation_id:
        conversation = db.scalar(select(Conversation).where(Conversation.id == payload.conversation_id, Conversation.user_id == user_id, Conversation.unit_id == payload.unit_id))
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = Conversation(id=uuid4(), user_id=user_id, unit_id=payload.unit_id, title=payload.message.strip()[:60] or "New conversation")
        db.add(conversation)
        db.flush()

    db.add(Message(conversation_id=conversation.id, role="user", content=payload.message))
    db.commit()
    history_rows = db.scalars(
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Message.conversation_id == conversation.id, Conversation.user_id == user_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(settings.chat_history_limit + 1)
    ).all()
    history_rows = list(reversed(history_rows))[:-1]
    history = [{"role": row.role, "content": row.content} for row in history_rows]

    def generate() -> Iterator[str]:
        assistant_text = ""
        completed = False
        terminal = False
        started = time.monotonic()
        try:
            agent = RetrievalAgent()
            for item in agent.answer_stream(user_id, payload.message, history, unit_id=payload.unit_id):
                if time.monotonic() - started >= 60:
                    raise TimeoutError("The chat request took longer than 60 seconds")
                if isinstance(item, dict) and item.get("type") == "status":
                    yield _event("status", {"text": str(item.get("text", "Searching your notes..."))})
                    continue
                token = str(item)
                assistant_text += token
                yield _event("token", {"text": token})
            sources = _sources(getattr(agent, "sources", []))
            yield _event("sources", sources)
            db.add(Message(conversation_id=conversation.id, role="assistant", content=assistant_text, sources=sources))
            db.commit()
            count_message(db, user_id)
            yield _event("done", {"conversation_id": str(conversation.id), "sources": sources})
            completed = True
            terminal = True
        except TimeoutError:
            completed = True
            yield _event("error", {"message": "That took a little too long. Please try again with a shorter question."})
            yield _event("done", {"conversation_id": str(conversation.id)})
            terminal = True
        except Exception as exc:
            logger.exception("Chat request failed for user %s", user_id)
            completed = True
            yield _event("error", {"message": _safe_error(exc)})
            yield _event("done", {"conversation_id": str(conversation.id)})
            terminal = True
        finally:
            if not terminal:
                yield _event("done", {"conversation_id": str(conversation.id)})

    return StreamingResponse(generate(), media_type="text/event-stream")


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, anthropic.APIError):
        return "Anthropic API request failed. Please try again later."
    return str(exc) or "Chat request failed."


def _single_error(message: str) -> Iterator[str]:
    yield _event("error", {"message": message})
    yield _event("done", {})


@router.get("/conversations")
def list_conversations(unit_id: UUID, user_id: UUID = Depends(current_chat_user), db: Session = Depends(get_db)) -> list[dict[str, object]]:
    """List conversations owned by the current user."""
    conversations = db.scalars(select(Conversation).where(Conversation.user_id == user_id, Conversation.unit_id == unit_id).order_by(Conversation.created_at.desc())).all()
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
