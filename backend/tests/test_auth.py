import time
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from uuid import UUID

from app.auth.supabase import SupabaseAuthProvider
from app.config import get_settings
from app.main import validate_startup_config


def credentials(token: str) -> SimpleNamespace:
    return SimpleNamespace(credentials=token)


def claims(user_id=None, **changes) -> dict:
    settings = get_settings()
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    payload = {
        "sub": str(user_id or uuid4()),
        "email": "user@example.com",
        "aud": "authenticated",
        "iss": issuer,
        "exp": int(time.time()) + 300,
    }
    payload.update(changes)
    return payload


def test_hs256_token(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_provider", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "supabase_jwt_secret", "test-shared-secret-that-is-long-enough")
    token = jwt.encode(claims(), settings.supabase_jwt_secret, algorithm="HS256")
    assert SupabaseAuthProvider().get_user_id(credentials(token))


def test_invalid_supabase_tokens(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_provider", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "supabase_jwt_secret", "test-shared-secret-that-is-long-enough")
    payloads = [
        claims(exp=int(time.time()) - 1),
        claims(aud="wrong"),
        claims(iss="https://wrong.example/auth/v1"),
        claims(sub=None),
    ]
    for payload in payloads:
        if payload["sub"] is None:
            payload.pop("sub", None)
        token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
        with pytest.raises(HTTPException) as exc:
            SupabaseAuthProvider().get_user_id(credentials(token))
        assert exc.value.status_code == 401


def test_tampered_and_none_tokens(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "supabase_jwt_secret", "test-shared-secret-that-is-long-enough")
    token = jwt.encode(claims(), settings.supabase_jwt_secret, algorithm="HS256")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    none_token = jwt.encode(claims(), key="", algorithm="none")
    for invalid in (tampered, none_token):
        with pytest.raises(HTTPException) as exc:
            SupabaseAuthProvider().get_user_id(credentials(invalid))
        assert exc.value.status_code == 401


def test_asymmetric_token_uses_jwks(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    signing_key = SimpleNamespace(key=private_key.public_key())

    class FakeClient:
        def __init__(self, _url, **_kwargs) -> None:
            pass
        def get_signing_key_from_jwt(self, _token) -> object:
            return signing_key

    monkeypatch.setattr("app.auth.supabase.PyJWKClient", FakeClient)
    monkeypatch.setattr("app.auth.supabase._jwks_clients", {})
    header = {"alg": "RS256", "kid": "test-key"}
    token = jwt.encode(claims(), private_key, algorithm="RS256", headers=header)
    assert SupabaseAuthProvider().get_user_id(credentials(token))


def test_valid_token_gets_usage_200_on_first_request(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "mode", "hosted")
    monkeypatch.setattr(settings, "auth_provider", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "supabase_jwt_secret", "test-shared-secret-that-is-long-enough")

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    from app.db.models import Base, Document, User, UserPlan
    Base.metadata.create_all(engine, tables=[User.__table__, UserPlan.__table__, Document.__table__])

    def db_session():
        with Session(engine) as db:
            yield db

    user_id = uuid4()
    payload = claims(user_id, user_metadata={"full_name": "First User"})
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")

    from app.main import app
    from app.db.session import get_db
    monkeypatch.setattr("app.api_documents.get_auth_provider", lambda: SupabaseAuthProvider())
    app.dependency_overrides[get_db] = db_session
    try:
        response = TestClient(app).get("/me/usage", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        with Session(engine) as db:
            user = db.get(User, UUID(str(user_id)))
            assert user is not None
            assert user.full_name == "First User"
            assert db.get(UserPlan, user.id) is not None
    finally:
        app.dependency_overrides.clear()


def test_bootstrap_is_user_scoped_and_has_stable_shape(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "mode", "selfhosted")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    from app.db.models import Base, Chunk, Conversation, Document, Unit, User
    Base.metadata.create_all(engine, tables=[User.__table__, Unit.__table__, Document.__table__, Chunk.__table__, Conversation.__table__])
    owner_id = uuid4()
    other_id = uuid4()
    owner_unit_id = uuid4()
    other_unit_id = uuid4()
    owner_unit = Unit(id=owner_unit_id, user_id=owner_id, name="Owner")
    other_unit = Unit(id=other_unit_id, user_id=other_id, name="Other")
    with Session(engine) as db:
        db.add_all([
            User(id=owner_id),
            User(id=other_id),
            owner_unit,
            other_unit,
            Conversation(id=uuid4(), user_id=owner_id, unit_id=owner_unit.id, title="Own chat"),
            Conversation(id=uuid4(), user_id=other_id, unit_id=other_unit.id, title="Other chat"),
        ])
        db.commit()

    def db_session():
        with Session(engine) as db:
            yield db

    from app.api_documents import current_user
    from app.main import app
    from app.db.session import get_db
    app.dependency_overrides[current_user] = lambda: owner_id
    app.dependency_overrides[get_db] = db_session
    try:
        response = TestClient(app).get(f"/me/bootstrap?unit_id={other_unit_id}")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert set(response.json()) == {"units", "usage", "conversations", "admin"}
        assert {item["name"] for item in response.json()["units"]} == {"Owner", "General"}
        assert [item["title"] for item in response.json()["conversations"]] == ["Own chat"]
        assert "Other chat" not in [item["title"] for item in response.json()["conversations"]]
    finally:
        app.dependency_overrides.clear()


def test_startup_guards(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "mode", "hosted")
    monkeypatch.setattr(settings, "auth_provider", "none")
    with pytest.raises(RuntimeError, match="AUTH_PROVIDER=supabase"):
        validate_startup_config()
