"""Anthropic-backed retrieval agent compatibility wrapper."""

from uuid import UUID

from app.agent.agent import RetrievalAgent


class ClaudeAgent:
    """Answer questions using Claude and retrieval search tools."""

    def __init__(self, api_key: str) -> None:
        """Initialize an agent with its Anthropic API key."""
        self.api_key = api_key

    def answer(self, user_id: str | UUID, question: str) -> str:
        """Answer a question using files available to the user."""
        answer, _sources = RetrievalAgent().answer(user_id, question)
        return answer
