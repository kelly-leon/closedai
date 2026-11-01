import logging
import smtplib
import socket
import httpx
from email.message import EmailMessage
from html import escape

from app.config import get_settings

logger = logging.getLogger(__name__)


def clean_header(value: object) -> str:
    return str(value or "").replace("\r", "").replace("\n", "")


def mailer_configured() -> bool:
    settings = get_settings()
    if settings.mail_provider == "smtp":
        return bool(settings.smtp_user and settings.smtp_password)
    if settings.mail_provider == "apps_script":
        return bool(settings.apps_script_url and settings.mail_secret)
    return False


def mailer_startup_name() -> str:
    settings = get_settings()
    return f"mailer: {settings.mail_provider}" if mailer_configured() else "mailer: disabled"


SMTP_HINT = "Render free instances block outbound SMTP ports; use MAIL_PROVIDER=apps_script or upgrade"


def _send_apps_script(to_email: str, subject: str, text_body: str, html_body: str, name: str, reply_to: str) -> tuple[bool, str, int | None]:
    settings = get_settings()
    payload = {
        "secret": settings.mail_secret,
        "to": clean_header(to_email),
        "subject": clean_header(subject),
        "text": text_body,
        "html": html_body,
        "name": clean_header(name),
        "replyTo": clean_header(reply_to),
    }
    for attempt in range(2):
        try:
            response = httpx.post(settings.apps_script_url, json=payload, follow_redirects=True, timeout=10)
            try:
                body = response.json()
            except Exception:
                if attempt == 0:
                    continue
                return False, "Apps Script returned a non-JSON response", None
            if isinstance(body, dict) and body.get("ok") is True:
                remaining = body.get("remaining")
                return True, "", remaining if isinstance(remaining, int) else None
            if attempt == 0:
                continue
            error = str(body.get("error") or "Apps Script rejected the request")[:160] if isinstance(body, dict) else "Apps Script rejected the request"
            return False, error, None
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt == 0:
                continue
            return False, "Apps Script request timed out", None
        except Exception as exc:
            return False, type(exc).__name__, None
    return False, "Apps Script request failed", None


def _send_message(message: EmailMessage) -> None:
    settings = get_settings()
    if settings.smtp_security == "starttls":
        client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
        with client:
            client.ehlo()
            client.starttls()
            client.ehlo()
            if settings.smtp_user:
                client.login(settings.smtp_user, settings.smtp_password)
            client.send_message(message)
    else:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as client:
            if settings.smtp_user:
                client.login(settings.smtp_user, settings.smtp_password)
            client.send_message(message)


def send_email_result(to_email: str, subject: str, text_body: str, html_body: str = "") -> tuple[bool, str]:
    sent, error, _remaining = send_email_detail(to_email, subject, text_body, html_body)
    return sent, error


def send_email_detail(to_email: str, subject: str, text_body: str, html_body: str = "") -> tuple[bool, str, int | None]:
    settings = get_settings()
    if not mailer_configured():
        return False, "mailer disabled", None
    if settings.mail_provider == "apps_script":
        return _send_apps_script(
            to_email,
            subject,
            text_body,
            html_body,
            settings.smtp_from_name or "ClosedAI",
            settings.admin_notify_email,
        )
    if settings.mail_provider != "smtp":
        return False, "mailer disabled", None

    message = EmailMessage()
    from_email = clean_header(settings.smtp_from_email or settings.smtp_user)
    from_name = clean_header(settings.smtp_from_name or "ClosedAI")
    message["From"] = f"{from_name} <{clean_header(from_email)}>" if from_name else clean_header(from_email)
    message["To"] = clean_header(to_email)
    message["Subject"] = clean_header(subject)
    if settings.admin_notify_email:
        message["Reply-To"] = clean_header(settings.admin_notify_email)
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html", charset="utf-8")

    transient_errors = (
        smtplib.SMTPServerDisconnected,
        smtplib.SMTPConnectError,
        smtplib.SMTPResponseException,
        TimeoutError,
        socket.timeout,
        OSError,
    )
    for attempt in range(2):
        try:
            _send_message(message)
            return True, "", None
        except transient_errors as exc:
            if attempt == 0:
                continue
            logger.warning("mailer: send failed transient recipient=%s", clean_header(to_email))
            if isinstance(exc, (TimeoutError, socket.timeout)):
                logger.error("mailer: %s", SMTP_HINT)
                return False, SMTP_HINT, None
            return False, "SMTP send failed", None
        except Exception as exc:
            logger.warning("mailer: send failed error=%s recipient=%s", type(exc).__name__, clean_header(to_email))
            if isinstance(exc, (TimeoutError, socket.timeout)):
                logger.error("mailer: %s", SMTP_HINT)
                return False, SMTP_HINT, None
            return False, "SMTP send failed", None
    return False, "SMTP send failed", None

def send_email(to_email: str, subject: str, text_body: str, html_body: str = "") -> bool:
    return send_email_result(to_email, subject, text_body, html_body)[0]


def html_text(text: str) -> str:
    return escape(text).replace("\n", "<br>")
