import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Document, UserPlan

NAIROBI = timezone(timedelta(hours=3))


def ensure_plan(db: Session, user_id: UUID) -> UserPlan:
    plan = db.get(UserPlan, user_id)
    if plan is None:
        settings = get_settings()
        plan = UserPlan(
            user_id=user_id,
            plan="trial",
            message_quota=0,
            document_quota=settings.trial_documents,
            messages_used=0,
            token_balance=0,
            trial_tokens_used=0,
            trial_period_start=datetime.utcnow(),
            daily_count=0,
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
    return plan


def trial_remaining(plan: UserPlan) -> int:
    settings = get_settings()
    return max(0, min(settings.trial_tokens_per_week, settings.trial_tokens_per_week - (plan.trial_tokens_used or 0)))


def apply_weekly_reset(db: Session, plan: UserPlan) -> UserPlan:
    now = datetime.utcnow()
    reset_before = now - timedelta(days=7)
    if plan.trial_period_start <= reset_before:
        result = db.execute(update(UserPlan).where(
            UserPlan.user_id == plan.user_id,
            UserPlan.trial_period_start == plan.trial_period_start,
            UserPlan.trial_period_start <= reset_before,
        ).values(trial_tokens_used=0, trial_period_start=now))
        db.commit()
        if result.rowcount:
            db.refresh(plan)
    return plan


def apply_daily_reset(db: Session, plan: UserPlan, now: datetime | None = None) -> UserPlan:
    current = (now or datetime.now(NAIROBI).replace(tzinfo=None)).date()
    if plan.daily_date is None or plan.daily_date != current:
        result = db.execute(update(UserPlan).where(
            UserPlan.user_id == plan.user_id,
            (UserPlan.daily_date.is_(None)) | (UserPlan.daily_date != current),
        ).values(daily_count=0, daily_date=current))
        db.commit()
        if result.rowcount:
            db.refresh(plan)
    return plan


def documents_used(db: Session, user_id: UUID) -> int:
    return int(db.scalar(select(func.count()).select_from(Document).where(Document.user_id == user_id)) or 0)


def limit_payload(limit: str, message: str) -> dict[str, str]:
    return {"code": "limit_reached", "limit": limit, "message": message}


def check_message_affordability(db: Session, user_id: UUID) -> None:
    if get_settings().mode != "hosted":
        return
    settings = get_settings()
    plan = apply_weekly_reset(db, ensure_plan(db, user_id))
    # Compatibility for rows created before hosted token billing. Keep the
    # legacy quota behavior until they are migrated by a new plan update.
    if plan.expires_at is not None and plan.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=402, detail=limit_payload("messages", "Your plan has expired. Open Upgrade to continue."))
    if plan.message_quota > 0 and plan.messages_used >= plan.message_quota and plan.token_balance == 0 and not plan.has_purchased:
        raise HTTPException(status_code=402, detail=limit_payload("messages", "You reached your message limit. Open Upgrade to continue."))
    now = datetime.utcnow()
    if plan.premium_until and plan.premium_until > now:
        plan = apply_daily_reset(db, plan)
        if plan.daily_count >= settings.premium_daily_cap:
            reset = (datetime.now(NAIROBI).replace(tzinfo=None).date() + timedelta(days=1))
            raise HTTPException(status_code=402, detail=limit_payload("daily_cap", f"You reached today's premium limit. It resets at midnight Nairobi ({reset.isoformat()})."))
        return
    if trial_remaining(plan) + plan.token_balance < settings.tokens_per_message:
        raise HTTPException(status_code=402, detail=limit_payload("tokens", "You don't have enough tokens. Open Upgrade to add tokens."))


def charge_tokens(db: Session, user_id: UUID, amount: int | None = None) -> bool:
    settings = get_settings()
    if settings.mode != "hosted":
        return True
    charge = settings.tokens_per_message if amount is None else amount
    plan = apply_weekly_reset(db, ensure_plan(db, user_id))
    if plan.premium_until and plan.premium_until > datetime.utcnow():
        result = db.execute(update(UserPlan).where(
            UserPlan.user_id == user_id,
            UserPlan.daily_count < settings.premium_daily_cap,
        ).values(daily_count=UserPlan.daily_count + 1))
        db.commit()
        return result.rowcount == 1
    trial_remaining_value = trial_remaining(plan)
    trial_charge = min(trial_remaining_value, charge)
    purchased_charge = charge - trial_charge
    statement = update(UserPlan).where(
        UserPlan.user_id == user_id,
        UserPlan.token_balance >= purchased_charge,
        trial_remaining_value >= trial_charge,
        UserPlan.trial_tokens_used + trial_charge <= settings.trial_tokens_per_week,
    ).values(
        trial_tokens_used=UserPlan.trial_tokens_used + trial_charge,
        token_balance=UserPlan.token_balance - purchased_charge,
        updated_at=datetime.utcnow(),
    )
    result = db.execute(statement)
    db.commit()
    return result.rowcount == 1


def check_limit(db: Session, user_id: UUID, limit: str) -> None:
    settings = get_settings()
    if settings.mode != "hosted":
        return
    if limit == "messages":
        check_message_affordability(db, user_id)
        return
    plan = ensure_plan(db, user_id)
    used = documents_used(db, user_id)
    quota = settings.premium_documents if plan.premium_until and plan.premium_until > datetime.utcnow() else (settings.paid_documents if plan.has_purchased else settings.trial_documents)
    if used >= quota:
        raise HTTPException(status_code=402, detail={"code": "limit_reached", "limit": "documents", "message": "You reached your document limit. Open Upgrade to continue."})


def count_message(db: Session, user_id: UUID) -> bool:
    return charge_tokens(db, user_id)


def normalize_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def code_hash(code: str) -> str:
    return hashlib.sha256(normalize_code(code).encode("ascii")).hexdigest()


def valid_admin_key(header: str | None) -> bool:
    expected = get_settings().admin_api_key
    return bool(expected) and header is not None and hmac.compare_digest(header, expected)
