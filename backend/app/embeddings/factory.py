"""Embedding provider selection."""

from app.config import get_settings
from app.embeddings.base import EmbeddingProvider


def get_embedding_provider() -> EmbeddingProvider:
    """Create the configured embedding provider."""
    settings = get_settings()
    if settings.embedding_provider == "local":
        from app.embeddings.local import LocalEmbeddingProvider
        return LocalEmbeddingProvider()
    if settings.embedding_provider == "voyage":
        from app.embeddings.voyage import VoyageEmbeddingProvider
        return VoyageEmbeddingProvider()
    if settings.embedding_provider == "openai":
        from app.embeddings.openai import OpenAIEmbeddingProvider
        return OpenAIEmbeddingProvider()
    raise ValueError(f"Unsupported embedding provider: {settings.embedding_provider}")
