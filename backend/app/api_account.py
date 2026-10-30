"""Account export and deletion routes."""

from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api_documents import current_user
from app.db.models import (
    AccountDeletionAudit,
    Chunk,
    Conversation,
    Document,
    Message,
    PaymentRequest,
    Unit,
    UsageEvent,
    User,
    UserPlan,
)
from app.db.session import get_db
from app.storage.factory import get_storage_provider
from app.config import get_settings

router = APIRouter(prefix="/me", tags=["account"])


class DeleteAccountPayload(BaseModel):
    confirm: str


@router.get("/export")
def export_account(user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    user = db.get(User, user_id)
    units = db.scalars(select(Unit).where(Unit.user_id == user_id)).all()
    conversations = db.scalars(select(Conversation).where(Conversation.user_id == user_id)).all()
    payments = db.scalars(select(PaymentRequest).where(PaymentRequest.user_id == user_id)).all()
    return {
        "profile": {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "created_at": user.created_at.isoformat(),
        } if user else {},
        "units": [{"id": str(item.id), "name": item.name, "created_at": item.created_at.isoformat()} for item in units],
        "conversations": [
            {
                "id": str(item.id),
                "title": item.title,
                "created_at": item.created_at.isoformat(),
                "messages": [
                    {"role": message.role, "content": message.content, "sources": message.sources, "created_at": message.created_at.isoformat()}
                    for message in db.scalars(select(Message).join(Conversation, Conversation.id == Message.conversation_id).where(Message.conversation_id == item.id, Conversation.user_id == user_id)).all()
                ],
            }
            for item in conversations
        ],
        "payment_requests": [
            {
                "id": str(item.id),
                "status": item.status,
                "amount_ksh": item.amount_ksh,
                "created_at": item.created_at.isoformat(),
            }
            for item in payments
        ],
    }


@router.delete("")
def delete_account(payload: DeleteAccountPayload, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, bool]:
    if payload.confirm != "DELETE":
        raise HTTPException(status_code=422, detail='Confirmation must be exactly "DELETE".')
    documents = db.scalars(select(Document).where(Document.user_id == user_id)).all()
    storage = get_storage_provider()
    for document in documents:
        storage.delete(document.storage_path)
    db.execute(delete(UsageEvent).where(UsageEvent.user_id == user_id))
    db.execute(delete(Message).where(Message.conversation_id.in_(select(Conversation.id).where(Conversation.user_id == user_id))))
    db.execute(delete(Chunk).where(Chunk.user_id == user_id))
    db.execute(delete(Conversation).where(Conversation.user_id == user_id))
    db.execute(delete(Document).where(Document.user_id == user_id))
    db.execute(delete(PaymentRequest).where(PaymentRequest.user_id == user_id))
    db.execute(delete(Unit).where(Unit.user_id == user_id))
    db.execute(delete(UserPlan).where(UserPlan.user_id == user_id))
    db.add(AccountDeletionAudit(reason="user_request"))
    db.execute(delete(User).where(User.id == user_id))
    db.commit()

    settings = get_settings()
    if settings.mode == "hosted":
        if not settings.supabase_url or not settings.supabase_service_key:
            raise HTTPException(status_code=500, detail="Account data was removed, but Supabase account removal is not configured.")
        try:
            response = httpx.delete(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
                headers={"Authorization": f"Bearer {settings.supabase_service_key}", "apikey": settings.supabase_service_key},
                timeout=10,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Account data was removed, but Supabase account removal failed.") from exc
    return {"deleted": True}
