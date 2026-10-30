"""Sentence-transformers embedding provider."""

from functools import lru_cache

from app.config import get_settings
from app.embeddings.base import EmbeddingProvider


@lru_cache(maxsize=1)
def _model(model_name: str):
    """Load and cache a local embedding model."""
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError(
            "Install requirements-local.txt to use local embeddings."
        ) from exc
    return SentenceTransformer(model_name)


class LocalEmbeddingProvider(EmbeddingProvider):
    """Generate embeddings with one cached local model."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts."""
        if not texts:
            return []
        vectors = _model(get_settings().local_embedding_model).encode(texts, normalize_embeddings=True)
        return [vector.tolist() for vector in vectors]
