import logging
from typing import Literal, TypedDict

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class NotifyResult(TypedDict):
    provider: Literal["resend", "telegram"]
    ok: bool
    status: int | None
    error: str


def configured_providers() -> list[Literal["resend", "telegram"]]:
    settings = get_settings()
    providers: list[Literal["resend", "telegram"]] = []
    if settings.resend_api_key and settings.admin_notify_email:
        providers.append("resend")
    if settings.telegram_bot_token and settings.telegram_chat_id:
        providers.append("telegram")
    return providers


def notifier_startup_name() -> str:
    providers = configured_providers()
    if len(providers) == 2:
        return "notifier: both"
    if providers == ["resend"]:
        return "notifier: resend"
    if providers == ["telegram"]:
        return "notifier: telegram"
    return "notifier: none (log only)"


def _response_reason(response: httpx.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            for key in ("message", "error", "description"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()[:160]
    except (ValueError, TypeError):
        pass
    return response.reason_phrase or "request failed"


def send_notification(message: str) -> list[NotifyResult]:
    settings = get_settings()
    results: list[NotifyResult] = []

    if settings.resend_api_key and settings.admin_notify_email:
        try:
            response = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={"from": "onboarding@resend.dev", "to": [settings.admin_notify_email],
                      "subject": "ClosedAI notification", "text": message},
                timeout=5,
            )
            response.raise_for_status()
            results.append({"provider": "resend", "ok": True, "status": response.status_code, "error": ""})
            logger.info("notification provider=resend status=%s error=", response.status_code)
        except httpx.TimeoutException:
            results.append({"provider": "resend", "ok": False, "status": None, "error": "timeout"})
            logger.warning("notification provider=resend status=timeout error=timeout")
        except httpx.HTTPStatusError as exc:
            reason = _response_reason(exc.response)
            results.append({"provider": "resend", "ok": False, "status": exc.response.status_code, "error": reason})
            logger.warning("notification provider=resend status=%s error=%s", exc.response.status_code, reason)
        except Exception as exc:
            reason = str(exc).splitlines()[0][:160] or "request failed"
            results.append({"provider": "resend", "ok": False, "status": None, "error": reason})
            logger.warning("notification provider=resend status=error error=%s", reason)

    if settings.telegram_bot_token and settings.telegram_chat_id:
        try:
            response = httpx.post(
                f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                json={"chat_id": settings.telegram_chat_id, "text": message},
                timeout=5,
            )
            response.raise_for_status()
            results.append({"provider": "telegram", "ok": True, "status": response.status_code, "error": ""})
            logger.info("notification provider=telegram status=%s error=", response.status_code)
        except httpx.TimeoutException:
            results.append({"provider": "telegram", "ok": False, "status": None, "error": "timeout"})
            logger.warning("notification provider=telegram status=timeout error=timeout")
        except httpx.HTTPStatusError as exc:
            reason = _response_reason(exc.response)
            results.append({"provider": "telegram", "ok": False, "status": exc.response.status_code, "error": reason})
            logger.warning("notification provider=telegram status=%s error=%s", exc.response.status_code, reason)
        except Exception as exc:
            reason = str(exc).splitlines()[0][:160] or "request failed"
            results.append({"provider": "telegram", "ok": False, "status": None, "error": reason})
            logger.warning("notification provider=telegram status=error error=%s", reason)
    return results


def notify_payment(email: str, package: str, amount: int, mpesa_code: str) -> None:
    settings = get_settings()
    message = (
        f"ClosedAI payment request\nUser: {email}\nPackage: {package}\n"
        f"Amount: KSh {amount}\nM-Pesa: {mpesa_code}\nReview: {settings.frontend_url.rstrip('/')}/admin"
    )
    if not send_notification(message):
        logger.info("Payment notification queued: user=%s package=%s amount=%s", email, package, amount)
