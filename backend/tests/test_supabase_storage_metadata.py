from unittest.mock import Mock

import pytest

import app.storage.supabase as supabase_storage
from app.storage.supabase import (
    StorageAuthError,
    StorageUnavailableError,
    SupabaseStorageProvider,
)


class Response:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise supabase_storage.httpx.HTTPStatusError(
                "storage error",
                request=Mock(),
                response=self,
            )

    def json(self):
        return self._payload


@pytest.fixture
def provider(monkeypatch):
    settings = supabase_storage.get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co/")
    monkeypatch.setattr(settings, "supabase_service_key", "service-key")
    monkeypatch.setattr(settings, "supabase_bucket", "documents")
    return SupabaseStorageProvider()


def test_object_info_uses_list_metadata(provider, monkeypatch):
    post = Mock(return_value=Response(200, [{"name": "file.txt", "metadata": {"size": 12, "mimetype": "text/plain"}}]))
    monkeypatch.setattr(supabase_storage.httpx, "post", post)

    metadata = provider.object_info("user folder/file.txt")

    assert metadata["size"] == 12
    assert metadata["mimetype"] == "text/plain"
    assert post.call_args.args[0].endswith("/storage/v1/object/list/documents")
    assert "Authorization" in post.call_args.kwargs["headers"]
    assert "apikey" in post.call_args.kwargs["headers"]


def test_object_info_404_is_not_found(provider, monkeypatch):
    monkeypatch.setattr(supabase_storage.httpx, "post", Mock(return_value=Response(404)))

    with pytest.raises(FileNotFoundError):
        provider.object_info("user/file.txt")


def test_object_info_401_is_storage_auth_error(provider, monkeypatch):
    monkeypatch.setattr(supabase_storage.httpx, "post", Mock(return_value=Response(401)))

    with pytest.raises(StorageAuthError):
        provider.object_info("user/file.txt")


def test_object_info_missing_size_uses_head(provider, monkeypatch):
    monkeypatch.setattr(
        supabase_storage.httpx,
        "post",
        Mock(return_value=Response(200, [{"name": "file.txt", "metadata": {"mimetype": "text/plain"}}])),
    )
    monkeypatch.setattr(
        supabase_storage.httpx,
        "head",
        Mock(return_value=Response(200, headers={"content-length": "12", "content-type": "text/plain"})),
    )

    metadata = provider.object_info("user/file.txt")

    assert metadata["size"] == "12"
    assert metadata["mimetype"] == "text/plain"
