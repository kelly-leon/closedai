"""Database-backed document ingestion pipeline."""

import logging
import threading
import time
from uuid import UUID

from sqlalchemy import delete

from app.db.models import Chunk, Document
from app.db.session import get_engine
from sqlalchemy.orm import Session

from app.embeddings.factory import get_embedding_provider
from app.ingest.chunk import chunk_pages
from app.ingest.parse import parse_document
from app.storage.factory import get_storage_provider

logger = logging.getLogger(__name__)


def _timed_stage(document_id: UUID, stage: str, started_at: float) -> None:
    logger.info("ingestion_stage document_id=%s stage=%s duration_ms=%.1f", document_id, stage, (time.perf_counter() - started_at) * 1000)


def _mark_timed_out(document_id: UUID, user_id: UUID, timeout_seconds: int) -> None:
    time.sleep(timeout_seconds)
    with Session(get_engine()) as db:
        document = db.get(Document, document_id)
        if document is not None and document.user_id == user_id and document.status == "processing":
            document.status = "failed"
            document.error_message = f"Ingestion timed out after {timeout_seconds} seconds."
            db.commit()
            logger.error("Ingestion timed out for document %s", document_id)


def ingest_document(document_id: UUID, user_id: UUID) -> None:
    """Parse, chunk, embed, and store one document idempotently."""
    from app.config import get_settings

    settings = get_settings()
    storage = get_storage_provider()
    embeddings = get_embedding_provider()
    with Session(get_engine()) as db:
        document = db.get(Document, document_id)
        if document is None or document.user_id != user_id:
            return
        try:
            document.status = "processing"
            document.error_message = None
            db.commit()
            logger.info("Ingesting document %s", document_id)
            watchdog = threading.Thread(
                target=_mark_timed_out,
                args=(document_id, user_id, settings.ingest_timeout_seconds),
                daemon=True,
                name=f"ingest-timeout-{document_id}",
            )
            watchdog.start()
            content = storage.read(document.storage_path)
            started_at = time.perf_counter()
            pages = parse_document(document.filename, content)
            _timed_stage(document_id, "parse", started_at)
            started_at = time.perf_counter()
            chunks = chunk_pages(pages)
            if not chunks:
                raise ValueError("Document produced no text chunks")
            _timed_stage(document_id, "chunk", started_at)
            db.execute(delete(Chunk).where(Chunk.document_id == document_id, Chunk.user_id == user_id))
            texts = [text for _, text in chunks]
            vectors: list[list[float]] = []
            started_at = time.perf_counter()
            for start in range(0, len(texts), settings.embedding_batch_size):
                batch = texts[start:start + settings.embedding_batch_size]
                vectors.extend(embeddings.embed_documents(batch))
                logger.info("Embedded chunks %s-%s for document %s", start, start + len(batch), document_id)
            _timed_stage(document_id, "embed", started_at)
            started_at = time.perf_counter()
            db.add_all([Chunk(document_id=document_id, user_id=user_id, unit_id=document.unit_id, chunk_index=index, content=text, page_number=page, embedding=vector) for index, (page, text), vector in zip(range(len(chunks)), chunks, vectors)])
            document.status = "ready"
            db.commit()
            _timed_stage(document_id, "store", started_at)
        except Exception as exc:
            db.rollback()
            document = db.get(Document, document_id)
            if document is not None and document.user_id == user_id and document.status != "failed":
                document.status = "failed"
                document.error_message = str(exc)[:2000]
                db.commit()
            logger.exception("Document ingestion failed for %s", document_id)
