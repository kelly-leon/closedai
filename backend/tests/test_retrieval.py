"""Retrieval scoping tests."""

from types import SimpleNamespace
from uuid import UUID

import app.agent.retrieval as retrieval


class FakeEmbedding:
    def embed_query(self, query: str) -> list[float]:
        return [0.1, 0.2]


class FakeDB:
    def execute(self, statement):
        sql = str(statement)
        assert "chunks.user_id" in sql
        assert "documents.user_id" in sql
        return SimpleNamespace(all=lambda: [SimpleNamespace(content="text", document_id=UUID(int=1), filename="a.pdf", page_number=2, similarity=0.8)])

    def close(self) -> None:
        pass


def test_search_chunks_filters_by_user(monkeypatch) -> None:
    class Generator:
        def close(self) -> None:
            pass

    monkeypatch.setattr(retrieval, "get_embedding_provider", lambda: FakeEmbedding())
    monkeypatch.setattr(retrieval, "get_db", lambda: iter([FakeDB()]))
    results = retrieval.search_chunks(UUID(int=2), "query")
    assert results[0]["filename"] == "a.pdf"
