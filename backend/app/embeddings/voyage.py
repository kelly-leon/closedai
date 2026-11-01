"""Voyage embedding provider with bounded batches and rate-limit backoff."""

import random
import threading
import time

import httpx

from app.config import get_settings
from app.embeddings.base import EmbeddingProvider


class VoyageRateLimitError(RuntimeError):
    pass


class VoyageConfigurationError(RuntimeError):
    pass


_REQUEST_LOCK = threading.Lock()
_LAST_REQUEST_AT = 0.0


class VoyageEmbeddingProvider(EmbeddingProvider):
    """Generate embeddings through Voyage AI."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.voyage_api_key:
            raise ValueError("VOYAGE_API_KEY is required")
        self.api_key = settings.voyage_api_key
        self.model = settings.voyage_embedding_model
        if not isinstance(settings.embedding_dim, int) or settings.embedding_dim <= 0:
            raise ValueError("EMBEDDING_DIM must be a positive integer")
        self.dimension = settings.embedding_dim
        self.batch_size = max(1, min(settings.embedding_batch_size, 1000))
        self.max_tokens = max(1, settings.embedding_max_tokens_per_request)
        self.max_wait = max(0.0, settings.voyage_max_wait_seconds)
        self.min_interval = max(0.0, settings.voyage_min_interval_seconds)

    def _estimate_tokens(self, texts: list[str]) -> int:
        # Voyage limits are token based; this conservative estimate avoids provider count assumptions.
        # https://docs.voyageai.com/docs/embeddings#python-api
        return sum(max(1, (len(text) + 3) // 4) for text in texts)

    def _batches(self, texts: list[str]) -> list[list[str]]:
        batches: list[list[str]] = []
        current: list[str] = []
        current_tokens = 0
        for text in texts:
            estimated = max(1, (len(text) + 3) // 4)
            if current and (len(current) >= self.batch_size or current_tokens + estimated > self.max_tokens):
                batches.append(current)
                current = []
                current_tokens = 0
            current.append(text)
            current_tokens += estimated
        if current:
            batches.append(current)
        return batches

    def _request(self, texts: list[str], input_type: str) -> list[list[float]]:
        started = time.monotonic()
        for attempt in range(8):
            with _REQUEST_LOCK:
                global _LAST_REQUEST_AT
                gap = self.min_interval - (time.monotonic() - _LAST_REQUEST_AT)
                if gap > 0:
                    time.sleep(gap)
                _LAST_REQUEST_AT = time.monotonic()
                response = httpx.post(
                    "https://api.voyageai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={"model": self.model, "input": texts, "input_type": input_type, "output_dimension": self.dimension},
                    timeout=60,
                )

            if response.status_code < 400:
                data = response.json()["data"]
                vectors = [item["embedding"] for item in sorted(data, key=lambda value: value["index"])]
                for index, vector in enumerate(vectors):
                    if len(vector) != self.dimension:
                        raise RuntimeError(f"Voyage returned vector {index} with length {len(vector)}; expected EMBEDDING_DIM={self.dimension}")
                return vectors
            if response.status_code == 401:
                raise VoyageConfigurationError("Voyage rejected the API key. Check VOYAGE_API_KEY.")
            if response.status_code == 402:
                raise VoyageConfigurationError("Voyage account needs a payment method or API credits. Add a payment method or credits in the Voyage dashboard.")
            if response.status_code == 400:
                raise VoyageConfigurationError(f"Voyage rejected the embedding request: {response.text[:500]}")
            if response.status_code != 429:
                response.raise_for_status()

            elapsed = time.monotonic() - started
            remaining = self.max_wait - elapsed
            if remaining <= 0 or attempt == 7:
                raise VoyageRateLimitError("The embedding service is busy. Press Retry in a few minutes.")
            retry_after = response.headers.get("Retry-After")
            try:
                delay = float(retry_after) if retry_after is not None else min(60.0, 2 ** attempt * (0.75 + random.random() * 0.5))
            except (TypeError, ValueError):
                delay = min(60.0, 2 ** attempt * (0.75 + random.random() * 0.5))
            time.sleep(min(delay, remaining))
        raise VoyageRateLimitError("The embedding service is busy. Press Retry in a few minutes.")

    def embed(self, texts: list[str]) -> list[list[float]]:
        result: list[list[float]] = []
        for batch in self._batches(texts):
            result.extend(self._request(batch, "query"))
        return result

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        result: list[list[float]] = []
        for batch in self._batches(texts):
            result.extend(self._request(batch, "document"))
        return result
