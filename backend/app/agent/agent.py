"""Anthropic retrieval agent with document search tool use."""

import logging
import time
from collections.abc import Iterator
from typing import Any
from uuid import UUID

import anthropic

from app.agent.retrieval import search_chunks
from app.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a helpful, friendly colleague—a knowledgeable classmate: warm, direct, and conversational.

Use the conversation context and always answer the current question. Before calling search_documents, rewrite vague follow-ups such as "expound on each", "explain more", or "what about the second one" into specific standalone queries using earlier user and assistant messages. For "each", identify the items from context and run one focused search per item. You may use search_documents multiple times in a turn.

First retry weak or empty searches with different keywords or synonyms. If documents cover a topic partially, answer with what is supported by the notes. Clearly label any added general knowledge as "Beyond your notes: ..."; never treat that knowledge as document content and never cite it.
If no relevant content is found, do not stop at that sentence—briefly explain what you checked, offer a useful nearby answer if grounded, and suggest how the notes could be clarified.
Make a reasonable assumption for ambiguous requests, state it in one line, and answer. Ask a clarifying question only as a last resort.
Cite only facts supported by retrieved text as [filename, page X] or [page X]. Never invent citations. When done, offer one short useful next step, such as "Want a quick quiz on this?"""

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

    def answer(self, user_id: UUID | str, message: str, history: list[dict[str, str]] | None = None, unit_id: UUID | str | None = None, retrieval_events: list[dict[str, Any]] | None = None) -> tuple[str, list[dict[str, Any]]]:
        """Answer a message and return the final text and retrieved source chunks."""
        if unit_id is None:
            raise ValueError("unit_id is required for document search")
        settings = get_settings()
        recent_history = list(history or [])[-settings.chat_history_limit:]
        messages = recent_history + [{"role": "user", "content": message}]
        sources: list[dict[str, Any]] = []
        started = time.monotonic()
        self.input_tokens = 0
        self.output_tokens = 0
        for _round in range(self.settings.max_tool_rounds + 1):
            if time.monotonic() - started >= 60:
                raise TimeoutError("The request took longer than 60 seconds")
            response = self.client.messages.create(
                model=self.settings.anthropic_model,
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=[SEARCH_TOOL],
                messages=messages,
            )
            usage = getattr(response, "usage", None)
            if isinstance(usage, dict):
                self.input_tokens += int(usage.get("input_tokens", 0))
                self.output_tokens += int(usage.get("output_tokens", 0))
            else:
                self.input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
                self.output_tokens += int(getattr(usage, "output_tokens", 0) or 0)
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
                matches = search_chunks(user_id, query, unit_id=unit_id)
                logger.info("search_documents result: user=%s query=%r count=%d", user_id, query, len(matches))
                if retrieval_events is not None:
                    retrieval_events.append({
                        "phase": "searching",
                        "query": query,
                        "results": [{"filename": match["filename"], "page": match["page_number"], "score": match.get("similarity")} for match in matches],
                        "count": len(matches),
                    })
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

    def answer_stream(self, user_id: UUID | str, message: str, history: list[dict[str, str]] | None = None, unit_id: UUID | str | None = None) -> Iterator[dict[str, Any] | str]:
        """Stream status and answer text, using the tool loop for retrieval."""
        yield {"type": "status", "text": "Embedding your query...", "phase": "embedding", "query": message, "results": [], "count": 0}
        retrieval_events: list[dict[str, Any]] = []
        answer, self.sources = self.answer(user_id, message, history, unit_id=unit_id, retrieval_events=retrieval_events)
        for event in retrieval_events:
            yield {"type": "status", "text": f"Found {event['count']} result(s).", **event}
        if not retrieval_events:
            yield {"type": "status", "text": "Searching your notes...", "phase": "searching", "query": message, "results": [], "count": 0}
        yield answer


def run_agent_loop(client: Any, user_id: UUID | str, message: str, history: list[dict[str, str]] | None = None, unit_id: UUID | str | None = None) -> tuple[str, list[dict[str, Any]]]:
    """Run the retrieval agent loop with a caller-provided client."""
    agent = RetrievalAgent(client=client)
    return agent.answer(user_id, message, history, unit_id=unit_id)
