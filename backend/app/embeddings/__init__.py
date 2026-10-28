"""Embedding provider exports."""

from app.embeddings.base import EmbeddingProvider
from app.embeddings.factory import get_embedding_provider

__all__ = ["EmbeddingProvider", "get_embedding_provider"]
