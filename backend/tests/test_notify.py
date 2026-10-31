import httpx
import pytest

from app import notify
from app.config import get_settings


@pytest.fixture(autouse=True)
def resend_only(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "resend_api_key", "test-key")
    monkeypatch.setattr(settings, "admin_notify_email", "admin@example.com")
    monkeypatch.setattr(settings, "telegram_bot_token", "")
    monkeypatch.setattr(settings, "telegram_chat_id", "")


def test_resend_success(monkeypatch):
    def post(*args, **kwargs):
        return httpx.Response(202, json={"id": "sent"}, request=httpx.Request("POST", args[0]))

    monkeypatch.setattr(httpx, "post", post)
    result = notify.send_notification("test notification")
    assert result == [{"provider": "resend", "ok": True, "status": 202, "error": ""}]


def test_resend_403(monkeypatch):
    def post(*args, **kwargs):
        return httpx.Response(403, json={"message": "Forbidden"}, request=httpx.Request("POST", args[0]))

    monkeypatch.setattr(httpx, "post", post)
    result = notify.send_notification("test notification")[0]
    assert result["provider"] == "resend"
    assert result["ok"] is False
    assert result["status"] == 403
    assert result["error"] == "Forbidden"


def test_resend_timeout(monkeypatch):
    def post(*args, **kwargs):
        raise httpx.TimeoutException("timed out", request=httpx.Request("POST", args[0]))

    monkeypatch.setattr(httpx, "post", post)
    result = notify.send_notification("test notification")[0]
    assert result == {"provider": "resend", "ok": False, "status": None, "error": "timeout"}
