"""Agent vector-search tool placeholder."""


class SearchTool:
    """Search a user's uploaded document chunks."""

    def search(self, user_id: str, query: str, limit: int = 5) -> list[dict]:
        """Return the chunks most relevant to a query."""
        # TODO: Embed the query and search pgvector within the user's scope.
        raise NotImplementedError
