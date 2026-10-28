"""Claude agent placeholder."""


class ClaudeAgent:
    """Answer questions using Claude and retrieval search tools."""

    def __init__(self, api_key: str) -> None:
        """Initialize an agent with its Anthropic API key."""
        self.api_key = api_key

    def answer(self, user_id: str, question: str) -> str:
        """Answer a question using files available to the user."""
        # TODO: Run Claude with the document search tool.
        raise NotImplementedError
