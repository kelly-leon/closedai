from types import SimpleNamespace

import httpx

from app.config import get_settings
from app.embeddings.voyage import (
    VoyageConfigurationError,
    VoyageEmbeddingProvider,
    VoyageRateLimitError,
)


def provider(monkeypatch, **changes):
    settings = get_settings()
    monkeypatch.setattr(settings, "voyage_api_key", "test-key")
    monkeypatch.setattr(settings, "embedding_dim", 384)
    monkeypatch.setattr(settings, "voyage_min_interval_seconds", 0)
    for key, value in changes.items():
        monkeypatch.setattr(settings, key, value)
    return VoyageEmbeddingProvider()


def response(status, data=None, headers=None):
    return httpx.Response(status, json=data, headers=headers or {}, request=httpx.Request("POST", "https://api.voyageai.com/v1/embeddings"))


def test_rate_limit_retry_after_then_success(monkeypatch):
    embedding = provider(monkeypatch, voyage_max_wait_seconds=10)
    calls = 0

    def post(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return response(429, headers={"Retry-After": "0"})
        return response(200, {"data": [{"index": 0, "embedding": [0.1] * 384}]})

    monkeypatch.setattr(httpx, "post", post)
    vectors = embedding.embed_documents(["hello"])
    assert calls == 2
    assert len(vectors[0]) == 384


def test_repeated_rate_limits_honor_time_limit(monkeypatch):
    embedding = provider(monkeypatch, voyage_max_wait_seconds=0)
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: response(429, headers={"Retry-After": "1"}))
    try:
        embedding.embed_documents(["hello"])
        assert False, "expected VoyageRateLimitError"
    except VoyageRateLimitError:
        pass


def test_401_is_not_retried(monkeypatch):
    embedding = provider(monkeypatch)
    calls = 0

    def post(*args, **kwargs):
        nonlocal calls
        calls += 1
        return response(401, {"detail": "invalid"})

    monkeypatch.setattr(httpx, "post", post)
    try:
        embedding.embed_documents(["hello"])
        assert False, "expected VoyageConfigurationError"
    except VoyageConfigurationError as exc:
        assert "rejected the API key" in str(exc)
    assert calls == 1
