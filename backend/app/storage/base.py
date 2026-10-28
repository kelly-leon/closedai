"""Uploaded-file storage abstraction."""

from abc import ABC, abstractmethod


class StorageProvider(ABC):
    """Store and retrieve uploaded user files."""

    @abstractmethod
    def put(self, key: str, content: bytes) -> str:
        """Store bytes under a key and return their storage location."""
        raise NotImplementedError

    @abstractmethod
    def get(self, key: str) -> bytes:
        """Retrieve bytes for a stored key."""
        raise NotImplementedError

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete a stored file."""
        raise NotImplementedError

    def save(self, key: str, content: bytes) -> str:
        """Store bytes under a key."""
        return self.put(key, content)

    def read(self, key: str) -> bytes:
        """Read bytes for a key."""
        return self.get(key)
