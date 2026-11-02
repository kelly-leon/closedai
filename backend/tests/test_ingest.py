"""Small ingestion unit tests."""

from io import BytesIO
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.main as main_module
from app.api_documents import retry_document
from app.db.models import Base, Document, Unit, User
from app.ingest.chunk import chunk_text
from app.ingest.parse import SCANNED_PDF_MESSAGE, parse_document, prepare_image, verify_file_signature
from app.db.models import Chunk
from app.ingest.pipeline import ingest_document


def _png_bytes(size=(20, 20)):
    from PIL import Image
    output = BytesIO()
    Image.new("RGBA", size, (120, 30, 200, 255)).save(output, format="PNG")
    return output.getvalue()


def test_image_signature_and_exif_removal():
    from PIL import Image
    source = BytesIO()
    image = Image.new("RGB", (300, 200), "red")
    exif = Image.Exif()
    exif[36867] = "2026:11:02 08:00:00"
    image.save(source, format="JPEG", exif=exif)
    clean = prepare_image(source.getvalue(), "photo.jpg", 5 * 1024 * 1024)
    assert verify_file_signature("photo.jpg", clean) == "jpg"
    with Image.open(BytesIO(clean)) as result:
        assert result.getexif() == {}


def test_non_image_with_image_extension_is_rejected():
    with pytest.raises(ValueError, match="not a valid image"):
        prepare_image(b"plain text", "photo.png", 5 * 1024 * 1024)


def test_image_payload_over_limit_is_rejected():
    with pytest.raises(ValueError, match="exceeds"):
        prepare_image(_png_bytes(), "photo.png", 1)


def test_chunk_text_overlaps() -> None:
    text = "First complete sentence. " * 30
    chunks = chunk_text(text, size=100, overlap=20)
    assert len(chunks) > 1
    assert all(chunks)
    assert len(chunks[0]) <= 101


def test_parse_text_file() -> None:
    pages = parse_document("notes.md", b"# Heading\n\nHello world")
    assert pages == [(None, "# Heading\n\nHello world")]


def test_scanned_pdf_is_rejected(monkeypatch) -> None:
    class Page:
        def extract_text(self) -> str:
            return ""

    class Reader:
        def __init__(self, _stream) -> None:
            self.pages = [Page()]

    monkeypatch.setattr("app.ingest.parse.PdfReader", Reader)
    with pytest.raises(ValueError, match=r"scanned document"):
        parse_document("scan.pdf", b"%PDF-pdf")


def test_startup_recovery_marks_stale_documents(monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__, Unit.__table__, Document.__table__])
    with Session(engine) as db:
        user_id = uuid4()
        unit_id = uuid4()
        db.add_all([User(id=user_id), Unit(id=unit_id, user_id=user_id, name="General")])
        stale = Document(
            id=uuid4(), user_id=user_id, unit_id=unit_id, filename="stale.pdf",
            mime_type="application/pdf", size_bytes=1, storage_path="stale.pdf",
            status="pending", created_at=datetime.utcnow() - timedelta(minutes=3),
        )
        current = Document(
            id=uuid4(), user_id=user_id, unit_id=unit_id, filename="current.pdf",
            mime_type="application/pdf", size_bytes=1, storage_path="current.pdf",
            status="processing", created_at=datetime.utcnow(),
        )
        db.add_all([stale, current])
        db.commit()
        stale_id = stale.id
        current_id = current.id

    monkeypatch.setattr(main_module, "get_engine", lambda: engine)
    assert main_module.recover_interrupted_documents() == 1
    with Session(engine) as db:
        recovered = db.get(Document, stale_id)
        active = db.get(Document, current_id)
        assert recovered is not None and recovered.status == "failed"
        assert recovered.error_message == "Interrupted. Please re-upload."
        assert active is not None and active.status == "processing"


def test_ingestion_resume_keeps_committed_chunks(monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__, Unit.__table__, Document.__table__, Chunk.__table__])
    user_id = uuid4()
    unit_id = uuid4()
    document_id = uuid4()
    with Session(engine) as db:
        db.add_all([User(id=user_id), Unit(id=unit_id, user_id=user_id, name="General")])
        db.add(Document(id=document_id, user_id=user_id, unit_id=unit_id, filename="resume.txt", mime_type="text/plain", size_bytes=1, storage_path="resume.txt", status="pending", source_hash="old"))
        db.commit()

    class Storage:
        def read(self, _path):
            return b"content"

    calls = []
    class Embeddings:
        def embed_documents(self, texts):
            calls.append(len(texts))
            if len(calls) == 2:
                raise RuntimeError("interrupted")
            return [[0.1] * 384 for _ in texts]

    monkeypatch.setattr(main_module, "get_engine", lambda: engine)
    monkeypatch.setattr("app.ingest.pipeline.get_engine", lambda: engine)
    monkeypatch.setattr("app.ingest.pipeline.get_storage_provider", lambda: Storage())
    monkeypatch.setattr("app.ingest.pipeline.get_embedding_provider", lambda: Embeddings())
    monkeypatch.setattr("app.ingest.pipeline.parse_document", lambda *_args: [(None, "content")])
    monkeypatch.setattr("app.ingest.pipeline.chunk_pages", lambda _pages: [(None, "chunk-%s" % index) for index in range(250)])
    ingest_document(document_id, user_id)
    with Session(engine) as db:
        assert db.scalar(select(Chunk.document_id).where(Chunk.document_id == document_id)) is not None
        assert db.scalar(select(Document).where(Document.id == document_id)).status == "failed"

    with Session(engine) as db:
        db.get(Document, document_id).status = "pending"
        db.commit()
    ingest_document(document_id, user_id)
    with Session(engine) as db:
        assert db.scalar(select(Document).where(Document.id == document_id)).status == "ready"
        assert len(db.scalars(select(Chunk).where(Chunk.document_id == document_id)).all()) == 250
    assert calls == [200, 50, 50]


def test_retry_document_is_owned_and_failed_only() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__, Unit.__table__, Document.__table__])
    owner = uuid4()
    other = uuid4()
    unit = uuid4()
    document_id = uuid4()
    with Session(engine) as db:
        db.add_all([User(id=owner), User(id=other), Unit(id=unit, user_id=owner, name="General")])
        db.add(Document(
            id=document_id, user_id=owner, unit_id=unit, filename="failed.pdf",
            mime_type="application/pdf", size_bytes=1, storage_path="failed.pdf",
            status="failed", error_message="parse error",
        ))
        db.commit()
        tasks = BackgroundTasks()
        assert retry_document(document_id, tasks, owner, db)["status"] == "pending"
        assert db.get(Document, document_id).status == "pending"

    with Session(engine) as db:
        with pytest.raises(HTTPException) as exc:
            retry_document(document_id, BackgroundTasks(), other, db)
        assert exc.value.status_code == 404
