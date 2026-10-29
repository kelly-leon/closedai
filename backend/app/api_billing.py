import threading
import time
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api_documents import current_user
from app.config import get_settings
from app.db.models import RedeemCode, UserPlan
from app.db.session import get_db
from app.usage import code_hash, documents_used, ensure_plan, normalize_code, valid_admin_key

router = APIRouter(tags=["billing"])
_failures: dict[UUID, list[float]] = {}
_failures_lock = threading.Lock()


class CreateCodes(BaseModel):
    count: int = Field(gt=0, le=1000)
    message_quota: int = Field(gt=0)
    document_quota: int = Field(gt=0)
    duration_days: int = Field(gt=0)


class RedeemPayload(BaseModel):
    code: str


ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_code() -> str:
    import secrets
    blocks = ["".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(3)]
    return "-".join(blocks)


@router.post("/admin/codes")
def create_codes(payload: CreateCodes, x_admin_key: str | None = Header(default=None), db: Session = Depends(get_db)) -> list[str]:
    if not valid_admin_key(x_admin_key):
        raise HTTPException(status_code=401, detail="Invalid admin key")
    plain_codes = []
    rows = []
    for _ in range(payload.count):
        while True:
            plain = generate_code()
            if db.scalar(select(RedeemCode).where(RedeemCode.code_hash == code_hash(plain))) is None:
                break
        plain_codes.append(plain)
        rows.append(RedeemCode(code_hash=code_hash(plain), plan_name="paid", message_quota=payload.message_quota, document_quota=payload.document_quota, duration_days=payload.duration_days))
    db.add_all(rows)
    db.commit()
    return plain_codes


@router.post("/redeem")
def redeem(payload: RedeemPayload, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    now = time.monotonic()
    with _failures_lock:
        attempts = [stamp for stamp in _failures.get(user_id, []) if now - stamp < 3600]
        if len(attempts) >= 5:
            raise HTTPException(status_code=429, detail="Too many attempts. Please try again later.")

    digest = code_hash(normalize_code(payload.code))
    row = db.scalar(select(RedeemCode).where(RedeemCode.code_hash == digest))
    if row is None or row.redeemed_at is not None:
        with _failures_lock:
            attempts = [stamp for stamp in _failures.get(user_id, []) if now - stamp < 3600]
            _failures[user_id] = attempts + [now]
        raise HTTPException(status_code=400, detail="Invalid or already used code.")

    row = db.get(RedeemCode, row.id, with_for_update=True)
    if row.redeemed_at is not None:
        raise HTTPException(status_code=400, detail="Invalid or already used code.")
    plan = ensure_plan(db, user_id)
    plan.plan = row.plan_name
    plan.message_quota = row.message_quota
    plan.document_quota = row.document_quota
    plan.messages_used = 0
    plan.expires_at = datetime.utcnow() + timedelta(days=row.duration_days)
    row.redeemed_by = user_id
    row.redeemed_at = datetime.utcnow()
    db.commit()
    return {"plan": plan.plan, "expires_at": plan.expires_at.isoformat(), "messages_used": 0, "message_quota": plan.message_quota, "document_quota": plan.document_quota}


@router.get("/me/usage")
def usage(user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    settings = get_settings()
    if settings.mode != "hosted":
        return {"plan": "unlimited", "messages_used": 0, "message_quota": None, "messages_quota": None, "documents_used": 0, "document_quota": None, "documents_quota": None, "expires_at": None}
    plan = ensure_plan(db, user_id)
    expired = plan.expires_at is not None and plan.expires_at <= datetime.utcnow()
    return {
        "plan": "expired" if expired else plan.plan,
        "messages_used": plan.messages_used,
        "message_quota": plan.message_quota,
        "messages_quota": plan.message_quota,
        "documents_used": documents_used(db, user_id),
        "document_quota": plan.document_quota,
        "documents_quota": plan.document_quota,
        "expires_at": plan.expires_at.isoformat() if plan.expires_at else None,
    }
