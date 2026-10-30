import asyncio
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api_account import delete_account
from app.api_chat import ChatRequest
from app.db.models import (
    AccountDeletionAudit,
    Base,
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
from app.ingest.parse import verify_file_signature
from app.main import validate_startup_config
from app.rate_limit import limiter, rate_limit


def test_chat_message_length_is_rejected():
    with pytest.raises(ValueError):
        ChatRequest(message="x" * 4001, unit_id=uuid4())


def test_rate_limit_returns_429_and_retry_after():
    limiter._events.clear()
    key = "test-rate-limit"
    rate_limit(key, 1, 60, "Please wait.")
    with pytest.raises(HTTPException) as exc:
        rate_limit(key, 1, 60, "Please wait.")
    assert exc.value.status_code == 429
    assert exc.value.headers["Retry-After"]


def test_rate_limit_exhaustion_returns_429():
    limiter._events.clear()
    key = "test-rate-limit-429"
    rate_limit(key, 1, 60, "Please wait.")
    with pytest.raises(HTTPException) as exc:
        rate_limit(key, 1, 60, "Please wait.")
    assert exc.value.status_code == 429
    assert exc.value.headers["Retry-After"]


def test_renamed_pdf_signature_is_rejected():
    with pytest.raises(ValueError, match="valid PDF"):
        verify_file_signature("renamed.pdf", b"not a pdf")


def test_hosted_cors_guard(monkeypatch):
    from app.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "mode", "hosted")
    monkeypatch.setattr(settings, "auth_provider", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "cors_origins", ["*"])
    with pytest.raises(RuntimeError, match="CORS"):
        validate_startup_config()


def test_account_deletion_removes_owned_data(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    user_id = uuid4()
    unit_id = uuid4()
    document_id = uuid4()
    conversation_id = uuid4()
    package_id = 1
    with Session(engine) as db:
        db.add(User(id=user_id))
        db.add(Unit(id=unit_id, user_id=user_id, name="General"))
        db.flush()
        db.add(Document(
            id=document_id, user_id=user_id, unit_id=unit_id, filename="a.txt",
            mime_type="text/plain", size_bytes=1, storage_path=f"{user_id}/a.txt",
            status="ready",
        ))
        db.add(Conversation(id=conversation_id, user_id=user_id, unit_id=unit_id, title="Chat"))
        db.flush()
        db.add(Message(conversation_id=conversation_id, role="user", content="hello"))
        db.add(UserPlan(user_id=user_id, plan="trial", message_quota=20, document_quota=3))
        db.commit()

        class Storage:
            def delete(self, key):
                return None

        monkeypatch.setattr("app.api_account.get_storage_provider", lambda: Storage())
        monkeypatch.setattr("app.api_account.get_settings", lambda: type("Settings", (), {"mode": "selfhosted"})())
        result = delete_account(type("Payload", (), {"confirm": "DELETE"})(), user_id, db)
        assert result["deleted"] is True
        assert db.scalar(select(User).where(User.id == user_id)) is None
        assert db.scalar(select(Document).where(Document.user_id == user_id)) is None
        assert db.scalar(select(Conversation).where(Conversation.user_id == user_id)) is None
        assert db.scalar(select(Unit).where(Unit.user_id == user_id)) is None
        assert db.scalar(select(UserPlan).where(UserPlan.user_id == user_id)) is None
        assert db.scalar(select(AccountDeletionAudit)) is not None
