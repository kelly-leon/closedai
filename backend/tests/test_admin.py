from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api_billing import admin_claims, admin_me, approve_request
from app.config import get_settings
from app.db.models import AuditLog, Base, Package, PaymentRequest, User, UserPlan


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    tables = [User.__table__, UserPlan.__table__, Package.__table__, PaymentRequest.__table__, AuditLog.__table__]
    Base.metadata.create_all(engine, tables=tables)
    with Session(engine) as session:
        yield session


def test_non_admin_gets_404(monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_emails", ["admin@example.com"])
    from fastapi.security import HTTPAuthorizationCredentials
    from app.auth import supabase
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")
    monkeypatch.setattr(supabase.SupabaseAuthProvider, "get_claims", lambda self, value: {"email": "other@example.com"})
    with pytest.raises(HTTPException) as exc:
        admin_claims(credentials)
    assert exc.value.status_code == 404


def test_double_approval_grants_once(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_emails", ["admin@example.com"])
    user = User(id=uuid4(), email="buyer@example.com")
    package = Package(id=1, name="Tokens", price_ksh=500, tokens=5000, active=True)
    request = PaymentRequest(user_id=user.id, package_id=package.id, amount_ksh=500, mpesa_code="ABC1234567")
    plan = UserPlan(user_id=user.id, plan="trial", message_quota=0, document_quota=3, messages_used=0,
                    token_balance=0, trial_tokens_used=0, trial_period_start=datetime.utcnow())
    db.add_all([user, package, request, plan])
    db.commit()
    claims = {"email": "admin@example.com"}
    approve_request(request.id, claims, db)
    db.refresh(plan)
    assert plan.token_balance == 5000
    with pytest.raises(HTTPException) as exc:
        approve_request(request.id, claims, db)
    assert exc.value.status_code == 409
    db.refresh(plan)
    assert plan.token_balance == 5000


def test_premium_extension_math(db):
    user = User(id=uuid4(), email="buyer@example.com")
    existing = datetime.utcnow() + timedelta(days=10)
    package = Package(id=1, name="Premium", price_ksh=1000, tokens=None, premium_days=90, active=True)
    request = PaymentRequest(user_id=user.id, package_id=package.id, amount_ksh=1000, mpesa_code="PREM123456", status="pending")
    plan = UserPlan(user_id=user.id, plan="trial", message_quota=0, document_quota=3, messages_used=0,
                    token_balance=0, trial_tokens_used=0, trial_period_start=datetime.utcnow(), premium_until=existing)
    db.add_all([user, package, request, plan])
    db.commit()
    approve_request(request.id, {"email": "admin@example.com"}, db)
    db.refresh(plan)
    assert plan.premium_until.date() == (existing + timedelta(days=90)).date()


def test_admin_me_returns_true():
    assert admin_me({"email": "admin@example.com"}) == {"is_admin": True}


def test_full_name_sync(monkeypatch, db):
    from types import SimpleNamespace
    from app.api_documents import current_user
    import app.api_documents as documents

    user_id = uuid4()
    db.add(User(id=user_id, email="old@example.com", full_name="Old Name"))
    db.commit()

    class Provider:
        def get_claims(self, credentials):
            return {"email": "new@example.com", "user_metadata": {"full_name": "New Name"}}
        def get_user_id(self, credentials):
            return str(user_id)

    monkeypatch.setattr(documents, "get_auth_provider", lambda: Provider())
    import asyncio
    resolved = asyncio.run(current_user(SimpleNamespace(credentials="token"), db))
    db.expire_all()
    user = db.get(User, user_id)
    assert resolved == user_id
    assert user.email == "new@example.com"
    assert user.full_name == "New Name"
