"""Authentication provider selection."""

from app.auth.base import AuthProvider
from app.auth.none import NoneAuthProvider
from app.auth.supabase import SupabaseAuthProvider
from app.config import get_settings


def get_auth_provider() -> AuthProvider:
    """Create the configured authentication provider."""
    settings = get_settings()
    if settings.mode == "selfhosted":
        return NoneAuthProvider()
    if settings.auth_provider == "supabase":
        return SupabaseAuthProvider()
    raise ValueError(f"Unsupported auth provider: {settings.auth_provider}")
