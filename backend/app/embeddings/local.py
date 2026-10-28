"""Sentence-transformers embedding provider."""

from functools import lru_cache

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None  # type: ignore[assignment,misc]

from app.config import get_settings
from app.embeddings.base import EmbeddingProvider


@lru_cache(maxsize=1)
def _model(model_name: str):
    """Load and cache a local embedding model."""
    if SentenceTransformer is None:
        raise RuntimeError("sentence-transformers is required for the local embedding provider")
    return SentenceTransformer(model_name)


class LocalEmbeddingProvider(EmbeddingProvider):
    """Generate embeddings with one cached local model."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts."""
        if not texts:
            return []
        vectors = _model(get_settings().local_embedding_model).encode(texts, normalize_embeddings=True)
        return [vector.tolist() for vector in vectors]
