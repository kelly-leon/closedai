"""Small ingestion unit tests."""

from app.ingest.chunk import chunk_text
from app.ingest.parse import parse_document


def test_chunk_text_overlaps() -> None:
    text = "First complete sentence. " * 30
    chunks = chunk_text(text, size=100, overlap=20)
    assert len(chunks) > 1
    assert all(chunks)
    assert len(chunks[0]) <= 101


def test_parse_text_file() -> None:
    pages = parse_document("notes.md", b"# Heading\n\nHello world")
    assert pages == [(None, "# Heading\n\nHello world")]
