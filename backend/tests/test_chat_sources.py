"""Tests for chat source formatting."""

from app.api_chat import _sources


def test_sources_are_deduplicated_and_truncated() -> None:
    results = [
        {"filename": "guide.pdf", "page_number": 2, "content": "x" * 250},
        {"filename": "guide.pdf", "page_number": 2, "content": "duplicate"},
        {"filename": "guide.pdf", "page_number": 3, "content": "third"},
    ]
    sources = _sources(results)
    assert len(sources) == 2
    assert len(sources[0]["snippet"]) == 200
    assert sources[1]["page"] == 3
