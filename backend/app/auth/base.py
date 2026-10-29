"""Authentication provider abstraction."""

from abc import ABC, abstractmethod


class AuthProvider(ABC):
    """Resolve the user identity associated with a request."""

    @abstractmethod
    def get_user_id(self, credentials: object | None = None) -> str:
        """Return the verified user ID, or raise on authentication failure."""
        raise NotImplementedError

    def get_claims(self, credentials: object | None = None) -> dict[str, object]:
        """Return verified claims when the provider supports them."""
        return {}
