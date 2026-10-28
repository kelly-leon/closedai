"""Agent tool-loop tests."""

from types import SimpleNamespace

import app.agent.agent as agent_module


class MockMessages:
    def __init__(self) -> None:
        self.calls = 0

    def create(self, **kwargs):
        self.calls += 1
        if self.calls == 1:
            return SimpleNamespace(stop_reason="tool_use", content=[{"type": "tool_use", "id": "tool-1", "input": {"query": "policy"}}])
        return SimpleNamespace(stop_reason="end_turn", content=[{"type": "text", "text": "Found in the policy."}])


class MockClient:
    def __init__(self) -> None:
        self.messages = MockMessages()


def test_agent_executes_tool_with_authenticated_user(monkeypatch) -> None:
    seen = []

    def fake_search(user_id, query, top_k=None):
        seen.append((str(user_id), query))
        return [{"content": "Allowed policy", "document_id": "d", "filename": "policy.pdf", "page_number": 3, "similarity": 0.9}]

    monkeypatch.setattr(agent_module, "search_chunks", fake_search)
    answer, sources = agent_module.run_agent_loop(MockClient(), "00000000-0000-0000-0000-000000000001", "What is the policy?", [])
    assert answer == "Found in the policy."
    assert seen == [("00000000-0000-0000-0000-000000000001", "policy")]
    assert sources[0]["filename"] == "policy.pdf"
