"""Local filesystem storage provider."""

from pathlib import Path

from app.config import get_settings
from app.storage.base import StorageProvider


class LocalStorageProvider(StorageProvider):
    """Persist uploaded files beneath UPLOAD_DIR."""

    def __init__(self) -> None:
        self.root = Path(get_settings().upload_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if path != self.root and self.root not in path.parents:
            raise ValueError("Storage path escapes UPLOAD_DIR")
        return path

    def put(self, key: str, content: bytes) -> str:
        """Write bytes under the configured upload directory."""
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return key

    def get(self, key: str) -> bytes:
        """Read bytes from the configured upload directory."""
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        """Delete a stored file if it exists."""
        self._path(key).unlink(missing_ok=True)

    def save(self, key: str, content: bytes) -> str:
        return self.put(key, content)

    def read(self, key: str) -> bytes:
        return self.get(key)
