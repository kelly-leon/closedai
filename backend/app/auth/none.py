"""No-login authentication for self-hosted deployments."""

from app.auth.base import AuthProvider


class NoneAuthProvider(AuthProvider):
    """Provide one fixed default user in self-hosted mode."""

    def get_user_id(self, credentials: object | None = None) -> str:
        """Return the default self-hosted user ID."""
        return "00000000-0000-0000-0000-000000000001"
