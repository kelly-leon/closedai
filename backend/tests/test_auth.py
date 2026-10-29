import time
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

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


def test_startup_guards(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "mode", "hosted")
    monkeypatch.setattr(settings, "auth_provider", "none")
    with pytest.raises(RuntimeError, match="AUTH_PROVIDER=supabase"):
        validate_startup_config()
