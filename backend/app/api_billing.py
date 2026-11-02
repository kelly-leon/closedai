import re
import threading
import time
from datetime import datetime, timedelta
from html import escape
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api_documents import current_user
from app.auth.factory import get_auth_provider
from app.config import get_settings
from app.db.models import AuditLog, Package, PaymentRequest, RedeemCode, User, UserPlan, UsageEvent
from app.db.session import get_db
from app.mailer import mailer_configured, mailer_status, send_email, send_email_detail, send_email_result
from app.notify import configured_providers, notify_payment, send_notification
from app.rate_limit import rate_limit
from app.usage import apply_daily_reset, apply_weekly_reset, code_hash, documents_used, ensure_plan, normalize_code, trial_remaining, valid_admin_key

router = APIRouter(tags=["billing"])
bearer = HTTPBearer(auto_error=False)
failures: dict[UUID, list[float]] = {}
failures_lock = threading.Lock()
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class _DirectBackgroundTasks(BackgroundTasks):
    pass


def generate_code() -> str:
    import secrets
    blocks = ["".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(3)]
    return "-".join(blocks)


class CreateCodes(BaseModel):
    count: int = Field(gt=0, le=1000)
    tokens: int = Field(gt=0)
    premium_days: int = 0


class RedeemPayload(BaseModel):
    code: str


class PaymentPayload(BaseModel):
    package_id: int
    mpesa_code: str


class RejectPayload(BaseModel):
    reason: str = ""


class GrantPayload(BaseModel):
    email: str
    tokens: int = 0
    premium_days: int = 0
    note: str = ""
    notify_user: bool = True


def admin_claims(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    settings = get_settings()
    claims = get_auth_provider().get_claims(credentials)
    email = str(claims.get("email", "")).strip().lower()
    if email not in {value.lower() for value in settings.admin_emails}:
        raise HTTPException(status_code=404, detail="Not found")
    return claims


@router.get("/admin/me")
def admin_me(claims=Depends(admin_claims)) -> dict[str, object]:
    settings = get_settings()
    status = mailer_status()
    return {"is_admin": True, "notifier_configured": bool(configured_providers()), "mailer_configured": mailer_configured(), "mail_provider": settings.mail_provider, "mailer_status": status}


@router.get("/admin/notify-test")
def notify_test(claims=Depends(admin_claims)) -> list[dict[str, object]]:
    return send_notification("ClosedAI notification test. If you received this, alerts are working.")


@router.get("/admin/email-test")
def email_test(claims=Depends(admin_claims)) -> dict[str, object]:
    email = str(claims.get("email", "")).strip()
    settings = get_settings()
    if not mailer_configured():
        return {"provider": settings.mail_provider, "ok": False, "error": "mailer disabled"}
    sent, error, remaining = send_email_detail(email, "ClosedAI email test", "This is a ClosedAI email test.", "<p>This is a ClosedAI email test.</p>")
    result: dict[str, object] = {"provider": settings.mail_provider, "ok": sent, "error": "" if sent else error}
    if remaining is not None:
        result["remaining"] = remaining
    return result


@router.post("/admin/requests/{request_id}/resend-email")
def resend_request_email(request_id: UUID, claims=Depends(admin_claims), db: Session = Depends(get_db)) -> dict[str, object]:
    rate_limit(f"admin-resend-email:{claims.get('email', '')}", 5, 60, "Too many email resend attempts. Please wait before trying again.")
    row = db.get(PaymentRequest, request_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.notify_status not in {None, "failed"}:
        raise HTTPException(status_code=409, detail="This email does not need to be resent.")
    row.notify_status = None
    db.commit()
    if row.status == "rejected":
        _send_payment_rejection(db, row)
    else:
        _send_payment_award(db, row)
    return {"status": row.notify_status}


@router.post("/admin/codes")
def create_codes(payload: CreateCodes, x_admin_key: str | None = Header(default=None), db: Session = Depends(get_db)) -> list[str]:
    if not valid_admin_key(x_admin_key):
        raise HTTPException(status_code=401, detail="Invalid admin key")
    codes = []
    rows = []
    for _ in range(payload.count):
        while True:
            plain = generate_code()
            if db.scalar(select(RedeemCode).where(RedeemCode.code_hash == code_hash(plain))) is None:
                break
        codes.append(plain)
        rows.append(RedeemCode(code_hash=code_hash(plain), plan_name="paid", message_quota=0,
                               document_quota=0, duration_days=payload.premium_days, token_grant=payload.tokens))
    db.add_all(rows)
    db.commit()
    return codes


@router.post("/redeem")
def redeem(payload: RedeemPayload, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    now = time.monotonic()
    with failures_lock:
        attempts = [stamp for stamp in failures.get(user_id, []) if now - stamp < 3600]
        if len(attempts) >= 5:
            raise HTTPException(status_code=429, detail="Too many attempts. Please try again later.")
    row = db.scalar(select(RedeemCode).where(RedeemCode.code_hash == code_hash(payload.code)))
    if row is None or row.redeemed_at is not None:
        with failures_lock:
            failures[user_id] = attempts + [now]
        raise HTTPException(status_code=400, detail="Invalid or already used code.")
    row = db.get(RedeemCode, row.id, with_for_update=True)
    if row.redeemed_at is not None:
        raise HTTPException(status_code=400, detail="Invalid or already used code.")
    plan = ensure_plan(db, user_id)
    plan.token_balance += getattr(row, "token_grant", 0)
    if row.duration_days:
        start = max(datetime.utcnow(), plan.premium_until or datetime.min)
        plan.premium_until = start + timedelta(days=row.duration_days)
    plan.has_purchased = True
    row.redeemed_by = user_id
    row.redeemed_at = datetime.utcnow()
    db.commit()
    return {"tokens_added": getattr(row, "token_grant", 0), "premium_until": plan.premium_until.isoformat() if plan.premium_until else None}


@router.get("/billing/packages")
def packages(db: Session = Depends(get_db)) -> dict[str, object]:
    settings = get_settings()
    if settings.mode != "hosted":
        return {"packages": [], "till_number": "", "message": "Token award takes 30 to 60 minutes after payment."}
    rows = db.scalars(select(Package).where(Package.active.is_(True)).order_by(Package.price_ksh)).all()
    return {"packages": [{"id": row.id, "name": row.name, "price_ksh": row.price_ksh, "tokens": row.tokens, "premium_days": row.premium_days} for row in rows],
            "till_number": settings.mpesa_till_number, "message": "Token award takes 30 to 60 minutes after payment."}


@router.post("/billing/requests", status_code=201)
def create_payment(payload: PaymentPayload, background_tasks: BackgroundTasks, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    settings = get_settings()
    if settings.mode != "hosted":
        raise HTTPException(status_code=404, detail="Not found")
    code = payload.mpesa_code.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{10}", code):
        raise HTTPException(status_code=400, detail="Enter a valid 10-character M-Pesa code.")
    package = db.get(Package, payload.package_id)
    if package is None or not package.active:
        raise HTTPException(status_code=404, detail="Package not found")
    if db.scalar(select(func.count()).select_from(PaymentRequest).where(PaymentRequest.user_id == user_id, PaymentRequest.status == "pending")) >= 3:
        raise HTTPException(status_code=429, detail="Too many pending requests.")
    cutoff = datetime.utcnow() - timedelta(hours=1)
    if db.scalar(select(func.count()).select_from(PaymentRequest).where(PaymentRequest.user_id == user_id, PaymentRequest.created_at >= cutoff)) >= 5:
        raise HTTPException(status_code=429, detail="Too many payment requests. Please try again later.")
    if db.scalar(select(PaymentRequest.id).where(PaymentRequest.mpesa_code == code)) is not None:
        raise HTTPException(status_code=400, detail="This payment code has already been submitted.")
    user = db.get(User, user_id)
    row = PaymentRequest(user_id=user_id, package_id=package.id, amount_ksh=package.price_ksh, mpesa_code=code)
    db.add(row)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="This payment code has already been submitted.") from exc
    background_tasks.add_task(notify_payment, user.email or "", package.name, package.price_ksh, code)
    return {"id": str(row.id), "status": row.status}


@router.get("/billing/requests")
def user_requests(user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, object]]:
    rows = db.scalars(select(PaymentRequest).where(PaymentRequest.user_id == user_id).order_by(PaymentRequest.created_at.desc())).all()
    packages_by_id = {row.id: row for row in db.scalars(select(Package).where(Package.id.in_([item.package_id for item in rows]))).all()} if rows else {}
    return [{"id": str(row.id), "status": row.status, "amount_ksh": row.amount_ksh, "mpesa_code": row.mpesa_code,
             "package": packages_by_id[row.package_id].name if row.package_id in packages_by_id else "", "created_at": row.created_at.isoformat(),
             "reject_reason": row.reject_reason} for row in rows]


def _first_name(user: User | None) -> str:
    if user and user.full_name:
        return clean_name(user.full_name.split()[0])
    return "there"


def clean_name(value: str) -> str:
    return value.replace("\r", "").replace("\n", "").strip()


def _award_content(user: User, package: Package, plan: UserPlan, mpesa_code: str = "") -> tuple[str, str, str]:
    settings = get_settings()
    front_url = settings.frontend_url.rstrip("/")
    first_name = _first_name(user)
    premium = plan.premium_until
    if package.premium_days and premium:
        award = f"Premium access until {premium.strftime('%Y-%m-%d')}"
    else:
        award = f"{package.tokens or 0:,} tokens added"
    code_line = f"M-Pesa code ending: {mpesa_code[-4:]}" if mpesa_code else ""
    app_url = f"{front_url}/app"
    date = datetime.utcnow().strftime("%Y-%m-%d")
    subject = "Your ClosedAI tokens have been added"
    text_lines = [
        f"Hi {first_name},",
        "",
        f"Your {package.name} package was applied.",
        award,
        f"New token balance: {plan.token_balance:,}",
        code_line,
        f"Date: {date}",
        f"Open ClosedAI: {app_url}",
        "Please reply if anything looks wrong.",
    ]
    text = "\n".join(line for line in text_lines if line)
    html = "<p>" + escape(f"Hi {first_name},") + "</p>"
    html += "<p>" + escape(f"Your {package.name} package was applied.") + "<br>"
    html += escape(award) + "<br>" + escape(f"New token balance: {plan.token_balance:,}")
    if code_line:
        html += "<br>" + escape(code_line)
    html += "<br>" + escape(f"Date: {date}") + "</p>"
    html += f'<p><a href="{escape(app_url, quote=True)}">Open ClosedAI</a></p>'
    html += "<p>Please reply if anything looks wrong.</p>"
    return subject, text, html


def _record_payment_email(db: Session, request: PaymentRequest, sent: bool) -> None:
    request.notified_at = datetime.utcnow() if sent else request.notified_at
    request.notify_status = "sent" if sent else "failed"
    db.commit()


def _send_payment_award(db: Session, request: PaymentRequest) -> None:
    if request.notify_status == "sent":
        return
    if not mailer_configured():
        request.notify_status = "skipped"
        db.commit()
        return
    user = db.get(User, request.user_id)
    package = db.get(Package, request.package_id)
    plan = ensure_plan(db, request.user_id)
    if user is None or package is None or not user.email:
        request.notify_status = "skipped"
        db.commit()
        return
    subject, text, html = _award_content(user, package, plan, request.mpesa_code)
    sent = send_email(user.email, subject, text, html)
    _record_payment_email(db, request, sent)


def _send_payment_rejection(db: Session, request: PaymentRequest) -> None:
    if request.notify_status == "sent":
        return
    if not mailer_configured():
        request.notify_status = "skipped"
        db.commit()
        return
    user = db.get(User, request.user_id)
    if user is None or not user.email:
        request.notify_status = "skipped"
        db.commit()
        return
    settings = get_settings()
    front_url = settings.frontend_url.rstrip("/")
    reason = request.reject_reason or "No reason was provided."
    subject = "Your ClosedAI payment request was not approved"
    text = f"Your payment request was not approved.\nReason: {reason}\nReview packages: {front_url}/upgrade"
    html = "<p>Your payment request was not approved.</p>"
    html += f"<p>{escape('Reason: ' + reason)}</p>"
    html += f'<p><a href="{escape(front_url + "/upgrade", quote=True)}">Review ClosedAI packages</a></p>'
    _record_payment_email(db, request, send_email(user.email, subject, text, html))


@router.get("/admin/requests")
def admin_requests(status: str = "pending", claims=Depends(admin_claims), db: Session = Depends(get_db)) -> list[dict[str, object]]:
    if status not in {"pending", "approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Invalid status")
    rows = db.scalars(select(PaymentRequest).where(PaymentRequest.status == status).order_by(PaymentRequest.created_at)).all()
    result = []
    for row in rows:
        user = db.get(User, row.user_id)
        package = db.get(Package, row.package_id)
        result.append({"id": str(row.id), "email": user.email if user else "", "full_name": user.full_name if user else None, "package": package.name if package else "",
                       "amount_ksh": row.amount_ksh, "mpesa_code": row.mpesa_code, "created_at": row.created_at.isoformat(),
                       "notify_status": row.notify_status})
    return result


@router.post("/admin/requests/{request_id}/approve")
def approve_request(request_id: UUID, claims=Depends(admin_claims), db: Session = Depends(get_db), background_tasks: BackgroundTasks = _DirectBackgroundTasks()) -> dict[str, object]:
    from sqlalchemy import update
    now = datetime.utcnow()
    result = db.execute(update(PaymentRequest).where(PaymentRequest.id == request_id, PaymentRequest.status == "pending").values(status="approved", reviewed_at=now, reviewed_by=str(claims.get("email", ""))))
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="Request has already been reviewed.")
    row = db.get(PaymentRequest, request_id)
    package = db.get(Package, row.package_id)
    plan = ensure_plan(db, row.user_id)
    plan.has_purchased = True
    plan.token_balance += package.tokens or 0
    if package.premium_days:
        plan.premium_until = max(now, plan.premium_until or datetime.min) + timedelta(days=package.premium_days)
    db.commit()
    if not isinstance(background_tasks, _DirectBackgroundTasks):
        background_tasks.add_task(_send_payment_award, db, row)
    else:
        _send_payment_award(db, row)
    return {"status": "approved"}


@router.post("/admin/requests/{request_id}/reject")
def reject_request(request_id: UUID, payload: RejectPayload, claims=Depends(admin_claims), db: Session = Depends(get_db), background_tasks: BackgroundTasks = _DirectBackgroundTasks()) -> dict[str, object]:
    from sqlalchemy import update
    result = db.execute(update(PaymentRequest).where(PaymentRequest.id == request_id, PaymentRequest.status == "pending").values(status="rejected", reject_reason=payload.reason, reviewed_at=datetime.utcnow(), reviewed_by=str(claims.get("email", ""))))
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="Request has already been reviewed.")
    db.commit()
    row = db.get(PaymentRequest, request_id)
    if not isinstance(background_tasks, _DirectBackgroundTasks):
        background_tasks.add_task(_send_payment_rejection, db, row)
    else:
        _send_payment_rejection(db, row)
    return {"status": "rejected"}


@router.post("/admin/grant")
def admin_grant(payload: GrantPayload, claims=Depends(admin_claims), db: Session = Depends(get_db), background_tasks: BackgroundTasks = _DirectBackgroundTasks()) -> dict[str, object]:
    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.strip().lower()))
    if user is None or payload.tokens < 0 or payload.premium_days < 0 or not (payload.tokens or payload.premium_days):
        raise HTTPException(status_code=400, detail="Unable to grant tokens.")
    plan = ensure_plan(db, user.id)
    plan.token_balance += payload.tokens
    if payload.premium_days:
        plan.premium_until = max(datetime.utcnow(), plan.premium_until or datetime.min) + timedelta(days=payload.premium_days)
    plan.has_purchased = plan.has_purchased or bool(payload.tokens)
    db.add(AuditLog(admin_email=str(claims.get("email", "")), target_user_id=user.id, change=f"{payload.note}; tokens={payload.tokens}; premium_days={payload.premium_days}".strip("; ")))
    db.commit()
    if payload.notify_user:
        package = Package(name="Manual grant", tokens=payload.tokens, premium_days=payload.premium_days, price_ksh=0, active=True)
        subject, text, html = _award_content(user, package, plan)
        if not isinstance(background_tasks, _DirectBackgroundTasks):
            background_tasks.add_task(send_email, user.email or "", subject, text, html)
        else:
            send_email(user.email or "", subject, text, html)
    return {"status": "granted"}


@router.get("/admin/usage-summary")
def usage_summary(claims=Depends(admin_claims), db: Session = Depends(get_db)) -> dict[str, object]:
    def summary(days: int) -> dict[str, object]:
        cutoff = datetime.utcnow() - timedelta(days=days)
        rows = db.scalars(select(UsageEvent).where(UsageEvent.created_at >= cutoff)).all()
        count = len(rows)
        return {"answers": count,
                "average_input_tokens": round(sum(row.input_tokens for row in rows) / count, 2) if count else 0,
                "average_output_tokens": round(sum(row.output_tokens for row in rows) / count, 2) if count else 0,
                "per_model": {model: sum(1 for row in rows if row.model == model) for model in {row.model for row in rows}}}
    return {"last_7_days": summary(7), "last_30_days": summary(30)}


@router.get("/me/usage")
def usage(user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    settings = get_settings()
    if settings.mode != "hosted":
        return {"plan": "unlimited", "tokens_available": None, "trial_tokens_remaining": None, "trial_resets_at": None,
                "token_balance": None, "premium_until": None, "daily_used": None, "daily_cap": None,
                "documents_used": 0, "document_quota": None}
    plan = apply_weekly_reset(db, ensure_plan(db, user_id))
    premium = plan.premium_until is not None and plan.premium_until > datetime.utcnow()
    if premium:
        apply_daily_reset(db, plan)
    used = documents_used(db, user_id)
    quota = settings.premium_documents if premium else (settings.paid_documents if plan.has_purchased else settings.trial_documents)
    return {"plan": "premium" if premium else ("paid" if plan.has_purchased else "trial"),
            "tokens_available": trial_remaining(plan) + plan.token_balance,
            "trial_tokens_remaining": trial_remaining(plan),
            "trial_resets_at": (plan.trial_period_start + timedelta(days=7)).isoformat(),
            "token_balance": plan.token_balance,
            "premium_until": plan.premium_until.isoformat() if plan.premium_until else None,
            "daily_used": plan.daily_count if premium else None,
            "daily_cap": settings.premium_daily_cap if premium else None,
            "documents_used": used,
            "document_quota": quota}
