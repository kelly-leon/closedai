from email.message import EmailMessage
import httpx

from app import mailer
from app.config import get_settings
from app.config import Settings


class SMTPSSLStub:
    messages = []

    def __init__(self, *args, **kwargs):
        self.messages = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def login(self, user, password):
        return None

    def send_message(self, message):
        SMTPSSLStub.messages.append(message)


def test_mailer_disabled_sends_nothing(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mail_provider", "none")
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_password", "")
    assert mailer.send_email("user@example.com", "Test", "Body", "<p>Body</p>") is False


def test_mailer_neutralizes_header_injection(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mail_provider", "smtp")
    monkeypatch.setattr(settings, "smtp_user", "sender@example.com")
    monkeypatch.setattr(settings, "smtp_password", "password")
    monkeypatch.setattr(settings, "smtp_from_email", "sender@example.com")
    monkeypatch.setattr(settings, "smtp_security", "ssl")
    SMTPSSLStub.messages = []
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", SMTPSSLStub)

    assert mailer.send_email("user@example.com", "Test\r\nBcc: attacker@example.com", "Body", "<p>Body</p>")
    message = SMTPSSLStub.messages[0]
    assert isinstance(message, EmailMessage)
    assert message["Subject"] == "TestBcc: attacker@example.com"


def configure_apps_script(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mail_provider", "apps_script")
    monkeypatch.setattr(settings, "apps_script_url", "https://script.google.com/macros/s/test/exec")
    monkeypatch.setattr(settings, "mail_secret", "test-secret")


def test_apps_script_success(monkeypatch):
    configure_apps_script(monkeypatch)
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, json={"ok": True, "remaining": 498}, request=httpx.Request("POST", url))

    monkeypatch.setattr(mailer.httpx, "post", post)
    assert mailer.send_email_result("user@example.com", "Subject", "Text", "<p>HTML</p>") == (True, "")
    assert mailer.send_email_detail("user@example.com", "Subject", "Text", "<p>HTML</p>") == (True, "", 498)
    assert calls[0][1]["follow_redirects"] is True
    assert calls[0][1]["json"]["secret"] == "test-secret"


def test_apps_script_secret_rejected(monkeypatch):
    configure_apps_script(monkeypatch)
    monkeypatch.setattr(mailer.httpx, "post", lambda url, **kwargs: httpx.Response(
        200, json={"ok": False, "error": "unauthorized"}, request=httpx.Request("POST", url)))
    sent, error = mailer.send_email_result("user@example.com", "Subject", "Text")
    assert sent is False
    assert error == "unauthorized"


def test_apps_script_quota_exhausted(monkeypatch):
    configure_apps_script(monkeypatch)
    monkeypatch.setattr(mailer.httpx, "post", lambda url, **kwargs: httpx.Response(
        200, json={"ok": False, "error": "quota exhausted"}, request=httpx.Request("POST", url)))
    sent, error, remaining = mailer.send_email_detail("user@example.com", "Subject", "Text")
    assert sent is False
    assert error == "quota exhausted"
    assert remaining is None


def test_apps_script_timeout(monkeypatch):
    configure_apps_script(monkeypatch)

    def timeout(url, **kwargs):
        raise httpx.TimeoutException("timeout")

    monkeypatch.setattr(mailer.httpx, "post", timeout)
    sent, error = mailer.send_email_result("user@example.com", "Subject", "Text")
    assert sent is False
    assert error == "Apps Script request timed out"


def test_apps_script_status_missing_combinations(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mail_provider", "apps_script")
    monkeypatch.setattr(settings, "apps_script_url", "")
    monkeypatch.setattr(settings, "mail_secret", "")
    assert mailer.mailer_status()["missing"] == ["APPS_SCRIPT_URL", "MAIL_SECRET"]

    monkeypatch.setattr(settings, "apps_script_url", "https://script.google.com/macros/s/test/exec")
    assert mailer.mailer_status()["missing"] == ["MAIL_SECRET"]

    monkeypatch.setattr(settings, "apps_script_url", "")
    monkeypatch.setattr(settings, "mail_secret", "secret")
    assert mailer.mailer_status()["missing"] == ["APPS_SCRIPT_URL"]


def test_mail_secret_alias_and_precedence(monkeypatch):
    monkeypatch.setenv("MAIL_SECRET", "preferred-secret")
    monkeypatch.setenv("APPS_SCRIPT_SECRET", "alias-secret")
    settings = Settings(_env_file=None)
    assert settings.mail_secret == "preferred-secret"

    monkeypatch.delenv("MAIL_SECRET")
    settings = Settings(_env_file=None)
    assert settings.mail_secret == "alias-secret"


def test_mail_settings_are_trimmed(monkeypatch):
    monkeypatch.setenv("MAIL_PROVIDER", ' "apps_script" ')
    monkeypatch.setenv("APPS_SCRIPT_URL", "  'https://script.google.com/macros/s/test/exec'  ")
    monkeypatch.setenv("MAIL_SECRET", ' " top-secret " ')
    settings = Settings(_env_file=None)
    assert settings.mail_provider == "apps_script"
    assert settings.apps_script_url == "https://script.google.com/macros/s/test/exec"
    assert settings.mail_secret == "top-secret"


def test_mailer_status_does_not_leak_values(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mail_provider", "apps_script")
    monkeypatch.setattr(settings, "apps_script_url", "https://example.invalid/private/token")
    monkeypatch.setattr(settings, "mail_secret", "private-secret")
    status = mailer.mailer_status()
    rendered = repr(status)
    assert "private-secret" not in rendered
    assert "private/token" not in rendered
    assert status["hints"]
