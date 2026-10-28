"""Voyage embedding provider."""

import time

import httpx

from app.config import get_settings
from app.embeddings.base import EmbeddingProvider


class VoyageEmbeddingProvider(EmbeddingProvider):
    """Generate embeddings through Voyage AI."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.voyage_api_key:
            raise ValueError("VOYAGE_API_KEY is required")
        self.api_key = settings.voyage_api_key
        self.model = settings.voyage_embedding_model

    def _request(self, texts: list[str]) -> list[list[float]]:
        for attempt in range(3):
            response = httpx.post("https://api.voyageai.com/v1/embeddings", headers={"Authorization": f"Bearer {self.api_key}"}, json={"model": self.model, "input": texts, "input_type": "document"}, timeout=60)
            if response.status_code != 429:
                response.raise_for_status()
                data = response.json()["data"]
                return [item["embedding"] for item in sorted(data, key=lambda value: value["index"])]
            time.sleep(2 ** attempt)
        raise RuntimeError("Voyage embeddings rate limit retry exhausted")

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed texts in API batches."""
        result: list[list[float]] = []
        for start in range(0, len(texts), 128):
            result.extend(self._request(texts[start:start + 128]))
        return result
