"""Agent vector-search tool."""

from uuid import UUID

from app.agent.retrieval import search_chunks


class SearchTool:
    """Search a user's uploaded document chunks."""

    def search(self, user_id: str | UUID, unit_id: str | UUID, query: str, limit: int = 5) -> list[dict]:
        """Return the chunks most relevant to a query."""
        return search_chunks(user_id, query, limit, unit_id=unit_id)
