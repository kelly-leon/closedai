from unittest.mock import Mock

import pytest

import app.storage.supabase as supabase_storage
from app.storage.supabase import SupabaseStorageProvider


class MockResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


@pytest.mark.parametrize(
    "returned_url",
    [
        "/object/upload/sign/documents/user/file.txt?token=response-token",
        "https://project.supabase.co/object/upload/sign/documents/user/file.txt?token=response-token",
        "https://project.supabase.co/storage/v1/object/upload/sign/documents/user/file.txt?token=response-token",
        "/storage/v1/object/upload/sign/documents/user/file.txt?token=response-token",
    ],
)
def test_signed_upload_url_storage_base(monkeypatch, returned_url):
    settings = supabase_storage.get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co/")
    monkeypatch.setattr(settings, "supabase_service_key", "service-key")
    monkeypatch.setattr(settings, "supabase_bucket", "documents")
    monkeypatch.setattr(
        supabase_storage.httpx,
        "post",
        Mock(return_value=MockResponse({"token": "response-token", "url": returned_url})),
    )

    result = SupabaseStorageProvider().create_signed_upload_url("user/file.txt")

    assert result["upload_url"].startswith(
        "https://project.supabase.co/storage/v1/object/upload/sign/"
    )
    assert "response-token" in result["upload_url"]
