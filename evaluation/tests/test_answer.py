import json
import subprocess
import sys
from pathlib import Path
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


@pytest.fixture
def cli(tmp_path, monkeypatch):
    binary = tmp_path / "dsh"
    binary.write_text("#!/bin/sh\nexit 0\n")
    binary.chmod(0o755)
    home = tmp_path / "home"
    profile = home / "profiles" / "banso-dsh"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text("{}")
    case = tmp_path / "case.json"
    case.write_text(json.dumps(CASE))
    harness = FakeHarness()
    options = {}

    def factory(**kwargs):
        options.update(kwargs)
        print("SDK startup chatter")
        return harness

    monkeypatch.setattr(answer, "DeepSeekHarness", factory)
    args = ["--input", str(case), "--dsh-bin", str(binary), "--dsh-home", str(home),
            "--cwd", str(tmp_path), "--runs-dir", str(tmp_path / "runs")]
    return args, harness, options


def test_cli_file_stdout_and_env_precedence(cli, tmp_path, monkeypatch, capsys):
    args, harness, options = cli
    monkeypatch.setenv("DSH_MODEL", "from-process")
    env = tmp_path / ".env"
    env.write_text("DSH_MODEL=from-file\nDEEPSEEK_API_KEY=fake-test-secret\n")
    assert answer.main(args + ["--env-file", str(env), "--model", "from-cli"]) == 0
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["status"] == "ok"
    assert "SDK startup chatter" in captured.err
    assert "fake-test-secret" not in captured.out + captured.err
    assert options["model"] == "from-cli"
    assert options["env"]["DSH_MODEL"] == "from-file"
    assert options["env"]["DEEPSEEK_API_KEY"] == "fake-test-secret"
    assert harness.closed


def test_cli_stdin_and_answer_failure(cli, monkeypatch, capsys):
    from io import StringIO
    args, harness, _ = cli
    args[1] = "-"
    monkeypatch.setattr(sys, "stdin", StringIO(json.dumps(CASE)))
    harness.raw = "invalid"
    assert answer.main(args) == 1
    assert json.loads(capsys.readouterr().out)["status"] == "format_error"
    assert harness.closed


def test_cli_does_not_discover_env_and_file_model_overrides_process(cli, tmp_path, monkeypatch, capsys):
    args, _, options = cli
    monkeypatch.setenv("DSH_MODEL", "process-model")
    env = tmp_path / ".env"
    env.write_text("DSH_MODEL=file-model\n")
    monkeypatch.chdir(tmp_path)
    assert answer.main(args) == 0
    capsys.readouterr()
    assert options["env"] == {}
    assert options["model"] == "process-model"
    assert answer.main(args + ["--env-file", str(env)]) == 0
    capsys.readouterr()
    assert options["model"] == "file-model"


def test_library_log_io_failure_does_not_call_sdk(tmp_path):
    blocked = tmp_path / "file"
    blocked.write_text("not a directory")
    harness = FakeHarness()
    result = answer.answer_case(harness, CASE, runs_dir=blocked)
    assert result.status == "runtime_error"
    assert result.prediction is None
    assert not harness.calls


def test_startup_failure_is_configuration_error_and_closes_sdk(cli, capsys):
    args, harness, _ = cli
    def fail():
        raise RuntimeError("profile failed")
    harness.start = fail
    assert answer.main(args) == 2
    captured = capsys.readouterr()
    assert not captured.out
    assert "profile failed" in captured.err
    assert harness.closed


def test_real_module_cli_rejects_bad_input_before_sdk():
    completed = subprocess.run(
        [sys.executable, "-m", "banso_eval.answer", "--input", "-",
         "--dsh-bin", "/nonexistent/dsh", "--dsh-home", "/nonexistent/home"],
        input='{"id":1,"question":" ","answer_type":"item"}',
        text=True, capture_output=True, cwd=Path(__file__).resolve().parents[1],
    )
    assert completed.returncode == 2
    assert not completed.stdout
    assert "question must not be blank" in completed.stderr
