import json
import subprocess
import sys
from pathlib import Path

import pytest

from banso_eval import batch
from test_answer import CASE, FakeHarness


@pytest.fixture
def cli(tmp_path, monkeypatch):
    binary = tmp_path / "dsh"
    binary.write_text("#!/bin/sh\nexit 0\n")
    binary.chmod(0o755)
    home = tmp_path / "home"
    profile = home / "profiles" / "banso-dsh"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text("{}")
    case = tmp_path / "case.jsonl"
    case.write_text(json.dumps(CASE))
    harness = FakeHarness()
    options = {}

    def factory(**kwargs):
        options.update(kwargs)
        print("SDK startup chatter")
        return harness

    monkeypatch.setattr(batch, "DeepSeekHarness", factory)
    source = tmp_path / "source.json"
    source.write_text('{"revision":"test"}')
    args = ["--source", str(source), "--input", str(case), "--dsh-bin", str(binary), "--dsh-home", str(home),
            "--cwd", str(tmp_path), "--output", str(tmp_path / "runs")]
    return args, harness, options


def test_cli_file_stdout_and_env_precedence(cli, tmp_path, monkeypatch, capsys):
    args, harness, options = cli
    monkeypatch.setenv("DSH_MODEL", "from-process")
    env = tmp_path / ".env"
    env.write_text("DSH_MODEL=from-file\nDEEPSEEK_API_KEY=fake-test-secret\n")
    assert batch.main(args + ["--env-file", str(env), "--model", "from-cli"]) == 0
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["case_count"] == result["ok_count"] == 1
    output = tmp_path / "runs"
    row = json.loads((output / "results.jsonl").read_text())
    assert row["status"] == "ok"
    assert (output / "sessions" / row["session_id"] / "events.jsonl").is_file()
    assert "SDK startup chatter" in captured.err
    assert "fake-test-secret" not in captured.out + captured.err
    assert options["model"] == "from-cli"
    assert options["env"]["DSH_MODEL"] == "from-file"
    assert options["env"]["DEEPSEEK_API_KEY"] == "fake-test-secret"
    assert harness.closed


def test_cli_answer_failure(cli, tmp_path, capsys):
    args, harness, _ = cli
    harness.raw = "invalid"
    assert batch.main(args) == 1
    assert json.loads(capsys.readouterr().out)["ok_count"] == 0
    row = json.loads((tmp_path / "runs" / "results.jsonl").read_text())
    assert row["status"] == "format_error"
    assert harness.closed


def test_cli_does_not_discover_env_and_file_model_overrides_process(cli, tmp_path, monkeypatch, capsys):
    args, _, options = cli
    monkeypatch.setenv("DSH_MODEL", "process-model")
    env = tmp_path / ".env"
    env.write_text("DSH_MODEL=file-model\n")
    monkeypatch.chdir(tmp_path)
    assert batch.main(args) == 0
    capsys.readouterr()
    assert options["env"] == {}
    assert options["model"] == "process-model"
    args[args.index("--output") + 1] = str(tmp_path / "runs-file-env")
    assert batch.main(args + ["--env-file", str(env)]) == 0
    capsys.readouterr()
    assert options["model"] == "file-model"


def test_startup_failure_is_configuration_error_and_closes_sdk(cli, capsys):
    args, harness, _ = cli
    def fail():
        raise RuntimeError("profile failed")
    harness.start = fail
    assert batch.main(args) == 2
    captured = capsys.readouterr()
    assert not captured.out
    assert "profile failed" in captured.err
    assert harness.closed


def test_real_module_cli_rejects_bad_input_before_sdk(tmp_path):
    path = tmp_path / "bad.jsonl"
    path.write_text('{"id":1,"question":" ","answer_type":"item"}\n')
    completed = subprocess.run(
        [sys.executable, "-m", "banso_eval.batch", "--input", str(path),
         "--output", str(tmp_path / "run"),
         "--dsh-bin", "/nonexistent/dsh", "--dsh-home", "/nonexistent/home"],
        text=True, capture_output=True, cwd=Path(__file__).resolve().parents[1],
    )
    assert completed.returncode == 2
    assert not completed.stdout
    assert "question must not be blank" in completed.stderr
    assert not (tmp_path / "run").exists()
