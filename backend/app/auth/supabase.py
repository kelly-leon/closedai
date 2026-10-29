"""Supabase JWT authentication provider."""

import jwt
from uuid import UUID
from fastapi import HTTPException
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError

from app.auth.base import AuthProvider
from app.config import get_settings

_jwks_clients: dict[str, PyJWKClient] = {}
_AUTH_ERROR = "Invalid or expired authentication credentials"


def _jwks_client(url: str) -> PyJWKClient:
    client = _jwks_clients.get(url)
    if client is None:
        client = PyJWKClient(url, cache_keys=True)
        _jwks_clients[url] = client
    return client


class SupabaseAuthProvider(AuthProvider):
    """Verify Supabase JWTs and expose their subject as the user ID."""

    def get_user_id(self, credentials: object | None = None) -> str:
        """Validate credentials and return the JWT subject."""
        return str(self.verify(credentials)["sub"])

    def get_claims(self, credentials: object | None = None) -> dict[str, object]:
        return self.verify(credentials)

    def verify(self, credentials: object | None = None) -> dict[str, object]:
        if credentials is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        token = getattr(credentials, "credentials", credentials)
        settings = get_settings()
        try:
            if isinstance(token, str):
                header = jwt.get_unverified_header(token)
            else:
                raise InvalidTokenError("invalid token")
            algorithm = header.get("alg")
            issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
            if algorithm in {"ES256", "RS256"}:
                signing_key = _jwks_client(f"{issuer}/.well-known/jwks.json").get_signing_key_from_jwt(token)
                payload = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=[algorithm],
                    audience="authenticated",
                    issuer=issuer,
                    options={"require": ["exp", "sub", "aud", "iss"]},
                )
            elif algorithm == "HS256":
                if not settings.supabase_jwt_secret:
                    raise InvalidTokenError("shared secret is not configured")
                payload = jwt.decode(
                    token,
                    settings.supabase_jwt_secret,
                    algorithms=["HS256"],
                    audience="authenticated",
                    issuer=issuer,
                    options={"require": ["exp", "sub", "aud", "iss"]},
                )
            else:
                raise InvalidTokenError("unsupported algorithm")
            user_id = payload.get("sub")
            if not user_id:
                raise InvalidTokenError("missing subject")
            UUID(str(user_id))
            return payload
        except Exception as exc:
            if isinstance(exc, HTTPException):
                raise
            raise HTTPException(status_code=401, detail=_AUTH_ERROR) from exc
