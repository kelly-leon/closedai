"""Supabase Storage REST provider."""

import httpx

from app.config import get_settings
from app.storage.base import StorageProvider


class SupabaseStorageProvider(StorageProvider):
    """Upload and retrieve objects through Supabase Storage REST."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
        self.bucket = settings.supabase_bucket
        self.base_url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object"
        self.headers = {"Authorization": f"Bearer {settings.supabase_service_key}", "apikey": settings.supabase_service_key}

    def put(self, key: str, content: bytes) -> str:
        """Upload an object, replacing it when it already exists."""
        response = httpx.post(f"{self.base_url}/{self.bucket}/{key}", headers={**self.headers, "x-upsert": "true"}, content=content)
        response.raise_for_status()
        return key

    def get(self, key: str) -> bytes:
        """Download an object."""
        response = httpx.get(f"{self.base_url}/{self.bucket}/{key}", headers=self.headers)
        response.raise_for_status()
        return response.content

    def delete(self, key: str) -> None:
        """Delete an object."""
        response = httpx.delete(f"{self.base_url}/{self.bucket}", headers=self.headers, json={"prefixes": [key]})
        response.raise_for_status()

    def create_signed_upload_url(self, key: str) -> dict[str, str]:
        response = httpx.post(
            f"{self.base_url.rsplit('/object', 1)[0]}/object/upload/sign/{self.bucket}/{key}",
            headers=self.headers,
        )
        response.raise_for_status()
        payload = response.json()
        token = str(payload.get("token", ""))
        signed_url = str(payload.get("url", payload.get("signedURL", "")))
        if not token or not signed_url:
            raise RuntimeError("Supabase did not return a signed upload URL")
        settings = get_settings()
        if signed_url.startswith("/"):
            signed_url = f"{settings.supabase_url.rstrip('/')}{signed_url}"
        if "?" not in signed_url:
            signed_url = f"{signed_url}?token={token}"
        return {"upload_url": signed_url, "token": token}

    def object_info(self, key: str) -> dict[str, object]:
        response = httpx.get(
            f"{self.base_url}/info/{self.bucket}/{key}",
            headers=self.headers,
        )
        if response.status_code == 404:
            raise FileNotFoundError(key)
        response.raise_for_status()
        return response.json()

    def save(self, key: str, content: bytes) -> str:
        return self.put(key, content)

    def read(self, key: str) -> bytes:
        return self.get(key)
