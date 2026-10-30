"""Supabase Storage REST provider."""

import httpx
import logging
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from app.config import get_settings
from app.storage.base import StorageProvider


class StorageAuthError(RuntimeError):
    def __init__(self, key: str, status_code: int) -> None:
        super().__init__(key)
        self.status_code = status_code


class StorageUnavailableError(RuntimeError):
    pass


class SupabaseStorageProvider(StorageProvider):
    """Upload and retrieve objects through Supabase Storage REST."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
        self.bucket = settings.supabase_bucket
        self.base_url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object"
        self.headers = {"Authorization": f"Bearer {settings.supabase_service_key}", "apikey": settings.supabase_service_key}

        self.headers["Authorization"] = f"Bearer {settings.supabase_service_key}"

    def put(self, key: str, content: bytes) -> str:
        """Upload an object, replacing it when it already exists."""
        response = httpx.post(
            f"{self.base_url}/{quote(self.bucket, safe='')}/{quote(key, safe='/')}",
            headers={**self.headers, "x-upsert": "true"},
            content=content,
        )
        response.raise_for_status()
        return key

    def get(self, key: str) -> bytes:
        """Download an object."""
        response = httpx.get(
            f"{self.base_url}/{quote(self.bucket, safe='')}/{quote(key, safe='/')}",
            headers=self.headers,
        )
        response.raise_for_status()
        return response.content

    def delete(self, key: str) -> None:
        """Delete an object."""
        response = httpx.delete(
            f"{self.base_url}/{quote(self.bucket, safe='')}",
            headers=self.headers,
            json={"prefixes": [key]},
        )
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
        signed_url = self._storage_api_url(signed_url)
        if "?" not in signed_url:
            signed_url = f"{signed_url}?token={token}"
        return {"upload_url": signed_url, "token": token}

    def _storage_api_url(self, signed_url: str) -> str:
        project_url = get_settings().supabase_url.rstrip("/")
        parsed = urlsplit(signed_url)

        if parsed.scheme and parsed.netloc:
            path = parsed.path
            if "/storage/v1/" in path:
                return signed_url
            if path.startswith("/object/"):
                path = f"/storage/v1{path}"
            else:
                path = f"/storage/v1{path if path.startswith('/') else '/' + path}"
            return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))

        path = parsed.path if parsed.path.startswith("/") else f"/{parsed.path}"
        if path.startswith("/storage/v1/"):
            storage_path = path
        elif path.startswith("/object/"):
            storage_path = f"/storage/v1{path}"
        else:
            storage_path = f"/storage/v1{path}"
        query = urlencode(parse_qsl(parsed.query, keep_blank_values=True))
        return f"{project_url}{storage_path}" + (f"?{query}" if query else "")

    def object_info(self, key: str) -> dict[str, object]:
        prefix = key.rsplit("/", 1)[0]
        filename = key.rsplit("/", 1)[-1]
        object_url = f"{self.base_url}/{quote(self.bucket, safe='')}/{quote(key, safe='/')}"
        try:
            response = httpx.post(
                f"{self.base_url.rsplit('/object', 1)[0]}/object/list/{quote(self.bucket, safe='')}",
                headers=self.headers,
                json={"prefix": prefix, "limit": 100, "offset": 0, "search": filename},
            )
        except httpx.HTTPError as exc:
            logging.getLogger(__name__).warning(
                "Supabase Storage unreachable while checking bucket=%s path_prefix=%s",
                self.bucket,
                prefix,
            )
            raise StorageUnavailableError(key) from exc

        if response.status_code == 404:
            logging.getLogger(__name__).warning(
                "Supabase Storage object not found status=%s bucket=%s path_prefix=%s",
                response.status_code,
                self.bucket,
                prefix,
            )
            raise FileNotFoundError(key)
        if response.status_code in {401, 403}:
            logging.getLogger(__name__).warning(
                "Supabase Storage auth failed status=%s bucket=%s path_prefix=%s",
                response.status_code,
                self.bucket,
                prefix,
            )
            raise StorageAuthError(key, response.status_code)

        try:
            response.raise_for_status()
            entries = response.json()
        except httpx.HTTPError as exc:
            logging.getLogger(__name__).warning(
                "Supabase Storage unreachable status=%s bucket=%s path_prefix=%s",
                response.status_code,
                self.bucket,
                prefix,
            )
            raise StorageUnavailableError(key) from exc

        entry = next((item for item in entries if isinstance(item, dict) and item.get("name") == filename), None)
        if entry is None:
            logging.getLogger(__name__).warning(
                "Supabase Storage object not found status=404 bucket=%s path_prefix=%s",
                self.bucket,
                prefix,
            )
            raise FileNotFoundError(key)

        metadata = entry.get("metadata")
        if isinstance(metadata, dict):
            entry = {**entry, **metadata}
        if entry.get("size") is None and entry.get("contentLength") is None:
            try:
                head = httpx.head(object_url, headers=self.headers, timeout=30)
            except httpx.HTTPError as exc:
                logging.getLogger(__name__).warning(
                    "Supabase Storage unreachable during HEAD bucket=%s path_prefix=%s",
                    self.bucket,
                    prefix,
                )
                raise StorageUnavailableError(key) from exc
            if head.status_code == 404:
                raise FileNotFoundError(key)
            if head.status_code in {401, 403}:
                raise StorageAuthError(key, head.status_code)
            try:
                head.raise_for_status()
            except httpx.HTTPError as exc:
                raise StorageUnavailableError(key) from exc
            content_length = head.headers.get("content-length")
            if content_length is not None:
                entry["size"] = content_length
            content_type = head.headers.get("content-type")
            if content_type is not None:
                entry["mimetype"] = content_type
        return entry

    def save(self, key: str, content: bytes) -> str:
        return self.put(key, content)

    def read(self, key: str) -> bytes:
        return self.get(key)
