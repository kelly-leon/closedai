"""Anthropic retrieval agent with document search tool use."""

import logging
from collections.abc import Iterator
from typing import Any
from uuid import UUID

import anthropic

from app.agent.retrieval import search_chunks
from app.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Answer only from retrieved document content. If no relevant content is found, say so clearly. Cite sources as [filename, page X]. Never invent information. If the request is ambiguous, ask a clarifying question."""

SEARCH_TOOL = {
    "name": "search_documents",
    "description": "Search the current user's uploaded documents for relevant content.",
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "Focused search query"}},
        "required": ["query"],
    },
}


def _value(block: Any, name: str, default: Any = None) -> Any:
    if isinstance(block, dict):
        return block.get(name, default)
    return getattr(block, name, default)


class RetrievalAgent:
    """Run an Anthropic tool-use loop over user-scoped document chunks."""

    def __init__(self, client: Any | None = None) -> None:
        settings = get_settings()
        if client is None and not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        self.client = client or anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.settings = settings

    def answer(self, user_id: UUID | str, message: str, history: list[dict[str, str]] | None = None) -> tuple[str, list[dict[str, Any]]]:
        """Answer a message and return the final text and retrieved source chunks."""
        messages = list(history or []) + [{"role": "user", "content": message}]
        sources: list[dict[str, Any]] = []
        for _round in range(self.settings.max_tool_rounds + 1):
            response = self.client.messages.create(
                model=self.settings.anthropic_model,
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=[SEARCH_TOOL],
                messages=messages,
            )
            tool_blocks = [block for block in response.content if _value(block, "type") == "tool_use"]
            text_blocks = [_value(block, "text", "") for block in response.content if _value(block, "type") == "text"]
            if not tool_blocks or response.stop_reason != "tool_use":
                return "".join(text_blocks), sources

            messages.append({"role": "assistant", "content": response.content})
            tool_results = []
            for block in tool_blocks:
                tool_id = _value(block, "id")
                query = _value(_value(block, "input", {}), "query", "")
                logger.info("search_documents tool call: user=%s query=%r", user_id, query)
                matches = search_chunks(user_id, query)
                for match in matches:
                    if match not in sources:
                        sources.append(match)
                numbered = "\n".join(
                    f"[{index}] filename={match['filename']}, page={match['page_number']}\n{match['content']}"
                    for index, match in enumerate(matches, 1)
                ) or "No relevant document content was found."
                tool_results.append({"type": "tool_result", "tool_use_id": tool_id, "content": numbered})
            messages.append({"role": "user", "content": tool_results})
        raise RuntimeError("Maximum tool-use rounds exceeded")

    def answer_stream(self, user_id: UUID | str, message: str, history: list[dict[str, str]] | None = None) -> Iterator[str]:
        """Stream text tokens, using the non-streaming loop for tool rounds."""
        answer, self.sources = self.answer(user_id, message, history)
        yield answer


def run_agent_loop(client: Any, user_id: UUID | str, message: str, history: list[dict[str, str]] | None = None) -> tuple[str, list[dict[str, Any]]]:
    """Run the retrieval agent loop with a caller-provided client."""
    agent = RetrievalAgent(client=client)
    return agent.answer(user_id, message, history)
