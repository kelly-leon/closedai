"""Storage provider selection."""

from app.config import get_settings
from app.storage.base import StorageProvider
from app.storage.local import LocalStorageProvider
from app.storage.supabase import SupabaseStorageProvider


def get_storage_provider() -> StorageProvider:
    """Create the configured storage provider."""
    settings = get_settings()
    if settings.storage_provider == "local":
        return LocalStorageProvider()
    if settings.storage_provider == "supabase":
        return SupabaseStorageProvider()
    raise ValueError(f"Unsupported storage provider: {settings.storage_provider}")
