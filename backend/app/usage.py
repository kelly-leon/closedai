import hashlib
import hmac
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Document, UserPlan


def ensure_plan(db: Session, user_id: UUID) -> UserPlan:
    plan = db.get(UserPlan, user_id)
    if plan is None:
        settings = get_settings()
        plan = UserPlan(
            user_id=user_id,
            plan="trial",
            message_quota=settings.trial_messages,
            document_quota=settings.trial_documents,
            messages_used=0,
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
    return plan


def effective_plan(db: Session, user_id: UUID) -> tuple[UserPlan, bool]:
    settings = get_settings()
    if settings.mode != "hosted":
        plan = ensure_plan(db, user_id)
        return plan, False
    plan = ensure_plan(db, user_id)
    if plan.expires_at and plan.expires_at <= datetime.utcnow():
        return plan, True
    return plan, False


def documents_used(db: Session, user_id: UUID) -> int:
    return int(db.scalar(select(func.count()).select_from(Document).where(Document.user_id == user_id)) or 0)


def limit_payload(limit: str, message: str) -> dict[str, str]:
    return {"code": "limit_reached", "limit": limit, "message": message}


def check_limit(db: Session, user_id: UUID, limit: str) -> None:
    settings = get_settings()
    if settings.mode != "hosted":
        return
    plan, expired = effective_plan(db, user_id)
    if expired:
        raise HTTPException(status_code=402, detail=limit_payload(limit, "Your plan has expired. Redeem a code to continue."))
    used = documents_used(db, user_id) if limit == "documents" else plan.messages_used
    quota = plan.document_quota if limit == "documents" else plan.message_quota
    if used >= quota:
        raise HTTPException(status_code=402, detail=limit_payload(limit, f"You reached your {limit} limit. Redeem a code to continue."))


def count_message(db: Session, user_id: UUID) -> None:
    if get_settings().mode != "hosted":
        return
    plan = ensure_plan(db, user_id)
    if plan.expires_at and plan.expires_at <= datetime.utcnow():
        return
    plan.messages_used += 1
    db.commit()


def normalize_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def code_hash(code: str) -> str:
    return hashlib.sha256(normalize_code(code).encode("ascii")).hexdigest()


def valid_admin_key(header: str | None) -> bool:
    expected = get_settings().admin_api_key
    return bool(expected) and header is not None and hmac.compare_digest(header, expected)
