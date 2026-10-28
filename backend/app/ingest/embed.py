"""Ingestion embedding placeholders."""

from app.embeddings.base import EmbeddingProvider


def embed_chunks(chunks: list[str], provider: EmbeddingProvider) -> list[list[float]]:
    """Create embeddings for document chunks."""
    # TODO: Delegate chunk embedding to the configured provider.
    raise NotImplementedError
