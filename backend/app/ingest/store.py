"""Vector storage placeholders."""


def store_embeddings(user_id: str, document_id: str, chunks: list[str], vectors: list[list[float]]) -> None:
    """Persist chunks and vectors for later retrieval."""
    # TODO: Store pgvector embeddings and metadata transactionally.
    raise NotImplementedError
