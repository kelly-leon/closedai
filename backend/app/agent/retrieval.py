"""User-scoped pgvector document retrieval."""

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Chunk, Document
from app.db.session import get_db
from app.embeddings.factory import get_embedding_provider

logger = logging.getLogger(__name__)


def search_chunks(user_id: UUID | str, query: str, top_k: int | None = None, unit_id: UUID | str | None = None) -> list[dict[str, Any]]:
    """Return relevant chunks owned by the user above the similarity threshold."""
    settings = get_settings()
    limit = settings.top_k if top_k is None else top_k
    user = UUID(str(user_id))
    unit = UUID(str(unit_id)) if unit_id is not None else None
    query_embedding = get_embedding_provider().embed_query(query)
    db_gen = get_db()
    db: Session = next(db_gen)
    try:
        similarity = (1 - Chunk.embedding.cosine_distance(query_embedding)).label("similarity")
        statement = (
            select(Chunk.content, Chunk.document_id, Document.filename, Chunk.page_number, similarity)
            .join(Document, Document.id == Chunk.document_id)
            .where(Chunk.user_id == user, Document.user_id == user)
            .order_by(similarity.desc())
            .limit(limit)
        )
        if unit is not None:
            statement = statement.where(Chunk.unit_id == unit, Document.unit_id == unit)
        rows = db.execute(statement).all()
        results = []
        all_rows = []
        for row in rows:
            score = float(row.similarity)
            item = {
                "content": row.content,
                "document_id": str(row.document_id),
                "filename": row.filename,
                "page_number": row.page_number,
                "similarity": score,
            }
            all_rows.append(item)
            if score >= settings.similarity_threshold:
                results.append(item)
        if not results and all_rows:
            results = all_rows[:3]
            logger.info("Similarity threshold missed; returning top %d fallback chunks", len(results))
        logger.info("Retrieved %d chunks for user %s and query %r", len(results), user, query)
        return results
    finally:
        db.close()
        if hasattr(db_gen, "close"):
            db_gen.close()
