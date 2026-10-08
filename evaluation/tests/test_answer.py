import json
from types import SimpleNamespace

import pytest

from banso_eval import answer


CASE = {"id": 3, "question": "  Test question  ", "answer_type": "item", "topic": "test"}


class FakeHarness:
    def __init__(self, raw='{"value":"Answer"}', reason="completed", fail=False):
        self.raw, self.reason, self.fail = raw, reason, fail
        self.calls = []
        self.closed = False

    def run(self, prompt, *, session_id, on_notification):
        self.calls.append((prompt, session_id))
        events = [
            {"type": "assistant/message", "data": {"message": {
                "content": [{"type": "text", "text": self.raw}]}}},
            {"type": "turn/end", "data": {"reason": {"kind": self.reason}}},
        ]
        for event in events:
            on_notification(SimpleNamespace(method="session.event", payload={
                "sessionId": session_id, "event": event}))
        if self.fail:
            raise RuntimeError("transport disconnected")
        return SimpleNamespace(final_response=self.raw, finish_reason=self.reason)

    def start(self):
        pass

    def close(self):
        self.closed = True


def test_success_isolated_sessions_and_incremental_logs(tmp_path):
    harness = FakeHarness()
    first = answer.answer_case(harness, CASE, runs_dir=tmp_path)
    second = answer.answer_case(harness, CASE, runs_dir=tmp_path)
    assert first.status == second.status == "ok"
    assert first.prediction == "```tsv\nValue\nAnswer\n```"
    assert first.session_id != second.session_id
    assert not harness.closed
    assert CASE["question"] in harness.calls[0][0]
    assert first.elapsed_seconds >= 0
    records = [json.loads(s) for s in (tmp_path / first.session_id / "events.jsonl").read_text().splitlines()]
    assert len(records) == 2
    assert all(r["sessionId"] == first.session_id for r in records)


@pytest.mark.parametrize("raw,reason,status", [
    ('{"value":"A"}', "max-tokens", "incomplete"),
    ('{"value":"A"}', None, "incomplete"),
    ("", "completed", "empty_answer"),
    ("  ", "completed", "empty_answer"),
    ("not JSON", "completed", "format_error"),
])
def test_failure_results_keep_original_reply(tmp_path, raw, reason, status):
    result = answer.answer_case(FakeHarness(raw, reason), CASE, runs_dir=tmp_path)
    assert result.status == status
    assert result.prediction is None
    assert result.raw_answer == raw
    assert result.finish_reason == reason
    assert result.error


def test_runtime_failure_preserves_received_events(tmp_path):
    result = answer.answer_case(FakeHarness(fail=True), CASE, runs_dir=tmp_path)
    assert result.status == "runtime_error"
    assert result.raw_answer == '{"value":"Answer"}'
    assert result.finish_reason == "completed"
    assert result.prediction is None
    assert "transport disconnected" in result.error
    assert len((tmp_path / result.session_id / "events.jsonl").read_text().splitlines()) == 2


@pytest.mark.parametrize("update", [{"id": True}, {"question": " "}, {"answer_type": "text"}])
def test_invalid_input_never_calls_sdk(tmp_path, update):
    harness = FakeHarness()
    with pytest.raises(ValueError):
        answer.answer_case(harness, CASE | update, runs_dir=tmp_path)
    assert not harness.calls
    assert list(tmp_path.iterdir()) == []


def test_library_log_io_failure_does_not_call_sdk(tmp_path):
    blocked = tmp_path / "file"
    blocked.write_text("not a directory")
    harness = FakeHarness()
    result = answer.answer_case(harness, CASE, runs_dir=blocked)
    assert result.status == "runtime_error"
    assert result.prediction is None
    assert not harness.calls
