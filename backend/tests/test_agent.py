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


class FollowUpMessages:
    def __init__(self) -> None:
        self.calls = 0

    def create(self, **kwargs):
        self.calls += 1
        if self.calls == 1:
            return SimpleNamespace(stop_reason="tool_use", content=[
                {"type": "tool_use", "id": "normalization-1", "input": {"query": "1NF definition normalization"}},
                {"type": "tool_use", "id": "normalization-2", "input": {"query": "2NF definition normalization"}},
                {"type": "tool_use", "id": "normalization-3", "input": {"query": "3NF definition normalization"}},
            ])
        return SimpleNamespace(stop_reason="end_turn", content=[{"type": "text", "text": "Here is more detail on each normal form."}])


class FollowUpClient:
    def __init__(self) -> None:
        self.messages = FollowUpMessages()


def test_follow_up_expound_on_each_uses_specific_prior_items(monkeypatch) -> None:
    seen = []

    def fake_search(user_id, query, top_k=None):
        seen.append(query)
        return [{"content": query, "document_id": "d", "filename": "normalization.pdf", "page_number": 7, "similarity": 0.8}]

    monkeypatch.setattr(agent_module, "search_chunks", fake_search)
    history = [
        {"role": "user", "content": "Summarize database normalization."},
        {"role": "assistant", "content": "The key items are 1NF, 2NF, and 3NF."},
    ]
    answer, sources = agent_module.run_agent_loop(FollowUpClient(), "00000000-0000-0000-0000-000000000001", "please expound on each", history)
    assert answer == "Here is more detail on each normal form."
    assert seen == ["1NF definition normalization", "2NF definition normalization", "3NF definition normalization"]
    assert sources
