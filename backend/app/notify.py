import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


def notify_payment(email: str, package: str, amount: int, mpesa_code: str) -> None:
    settings = get_settings()
    message = (
        f"ClosedAI payment request\nUser: {email}\nPackage: {package}\n"
        f"Amount: KSh {amount}\nM-Pesa: {mpesa_code}\nReview: {settings.frontend_url.rstrip('/')}/admin"
    )
    try:
        if settings.resend_api_key and settings.admin_notify_email:
            httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={"from": "onboarding@resend.dev", "to": [settings.admin_notify_email],
                      "subject": "ClosedAI payment request", "text": message},
                timeout=5,
            ).raise_for_status()
        elif settings.telegram_bot_token and settings.telegram_chat_id:
            httpx.post(
                f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                json={"chat_id": settings.telegram_chat_id, "text": message},
                timeout=5,
            ).raise_for_status()
        if not (settings.resend_api_key or settings.telegram_bot_token):
            logger.info("Payment notification queued: user=%s package=%s amount=%s", email, package, amount)
    except Exception as exc:
        logger.warning("Payment notification failed and was ignored: %s", exc)
