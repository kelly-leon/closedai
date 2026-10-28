"""Supabase JWT authentication provider."""

from fastapi import HTTPException
from jose import JWTError, jwt

from app.auth.base import AuthProvider
from app.config import get_settings


class SupabaseAuthProvider(AuthProvider):
    """Verify Supabase JWTs and expose their subject as the user ID."""

    def get_user_id(self, credentials: object | None = None) -> str:
        """Validate credentials and return the JWT subject."""
        if credentials is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        token = getattr(credentials, "credentials", credentials)
        settings = get_settings()
        try:
            payload = jwt.decode(str(token), settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
            user_id = payload.get("sub")
            if not user_id:
                raise JWTError("missing subject")
            return str(user_id)
        except JWTError as exc:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials") from exc
