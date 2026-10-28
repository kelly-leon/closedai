"""OpenAI embedding provider."""

import time

import httpx

from app.config import get_settings
from app.embeddings.base import EmbeddingProvider


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """Generate embeddings through OpenAI."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required")
        self.api_key = settings.openai_api_key
        self.model = settings.openai_embedding_model

    def _request(self, texts: list[str]) -> list[list[float]]:
        for attempt in range(3):
            response = httpx.post("https://api.openai.com/v1/embeddings", headers={"Authorization": f"Bearer {self.api_key}"}, json={"model": self.model, "input": texts}, timeout=60)
            if response.status_code != 429:
                response.raise_for_status()
                return [item["embedding"] for item in sorted(response.json()["data"], key=lambda value: value["index"])]
            time.sleep(2 ** attempt)
        raise RuntimeError("OpenAI embeddings rate limit retry exhausted")

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed texts in API-sized batches."""
        return [vector for start in range(0, len(texts), 128) for vector in self._request(texts[start:start + 128])]
