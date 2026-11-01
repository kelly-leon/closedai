"""Database-backed document ingestion pipeline."""

import hashlib
import logging
import threading
import time
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import Chunk, Document
from app.db.session import get_engine
from app.embeddings.factory import get_embedding_provider
from app.embeddings.voyage import VoyageConfigurationError, VoyageRateLimitError
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
            document.error_message = "Ingestion timed out. Press Retry in a few minutes."
            db.commit()


def ingest_document(document_id: UUID, user_id: UUID) -> None:
    """Parse, embed, and commit chunks incrementally so ingestion can resume."""
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
            threading.Thread(target=_mark_timed_out, args=(document_id, user_id, settings.ingest_timeout_seconds), daemon=True).start()

            content = storage.read(document.storage_path)
            source_hash = hashlib.sha256(content).hexdigest()
            hash_changed = bool(document.source_hash and document.source_hash != source_hash)
            if hash_changed:
                db.execute(delete(Chunk).where(Chunk.document_id == document_id, Chunk.user_id == user_id))
            document.source_hash = source_hash

            pages = parse_document(document.filename, content)
            chunks = chunk_pages(pages)
            if not chunks:
                raise ValueError("Document produced no text chunks")
            document.chunks_total = len(chunks)
            db.commit()

            existing = set(db.scalars(select(Chunk.chunk_index).where(Chunk.document_id == document_id, Chunk.user_id == user_id)).all())
            missing = [index for index in range(len(chunks)) if index not in existing]
            document.chunks_done = len(chunks) - len(missing)
            db.commit()

            for group_start in range(0, len(missing), 200):
                group = missing[group_start:group_start + 200]
                texts = [chunks[index][1] for index in group]
                document.error_message = f"Embedding {document.chunks_done} of {len(chunks)} sections, waiting for the service to catch up"
                db.commit()
                vectors = embeddings.embed_documents(texts)
                db.add_all([
                    Chunk(document_id=document_id, user_id=user_id, unit_id=document.unit_id,
                          chunk_index=index, content=chunks[index][1], page_number=chunks[index][0], embedding=vector)
                    for index, vector in zip(group, vectors)
                ])
                document.chunks_done += len(group)
                document.error_message = f"Embedding {document.chunks_done} of {len(chunks)} sections"
                db.commit()

            document.status = "ready"
            document.error_message = None
            document.chunks_done = len(chunks)
            db.commit()
        except VoyageRateLimitError as exc:
            db.rollback()
            document = db.get(Document, document_id)
            if document is not None and document.user_id == user_id:
                document.status = "failed"
                document.error_message = "The embedding service is busy. Press Retry in a few minutes."
                db.commit()
            logger.exception("Voyage rate limit exhausted for document %s", document_id)
        except VoyageConfigurationError as exc:
            db.rollback()
            document = db.get(Document, document_id)
            if document is not None and document.user_id == user_id:
                document.status = "failed"
                document.error_message = str(exc)
                db.commit()
            logger.exception("Voyage configuration rejected for document %s", document_id)
        except Exception as exc:
            db.rollback()
            document = db.get(Document, document_id)
            if document is not None and document.user_id == user_id and document.status != "failed":
                document.status = "failed"
                document.error_message = str(exc)[:2000]
                db.commit()
            logger.exception("Document ingestion failed for %s", document_id)
