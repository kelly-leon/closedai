"""Embedding provider abstraction."""

from abc import ABC, abstractmethod


class EmbeddingProvider(ABC):
    """Convert text into numeric vector embeddings."""

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of text strings."""
        raise NotImplementedError

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed document text."""
        return self.embed(texts)

    def embed_query(self, text: str) -> list[float]:
        """Embed one query."""
        return self.embed([text])[0]
