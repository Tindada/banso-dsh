import json
import subprocess
import sys
from pathlib import Path

import pytest

from banso_eval import batch
from test_answer import CASE, FakeHarness


@pytest.fixture
def cli(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_DSH_MODEL", "test-model")
    monkeypatch.setattr(batch, "EVALUATION_DIR", tmp_path)
    binary = tmp_path / "dsh"
    binary.write_text("#!/bin/sh\nexit 0\n")
    binary.chmod(0o755)
    home = tmp_path / "home"
    profile = home / "profiles" / "banso-dsh"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text("{}")
    (tmp_path / "derived").mkdir()
    case = tmp_path / "derived" / "case.jsonl"
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
    (tmp_path / ".env").write_text(f"EVAL_DSH_BIN={binary}\nEVAL_DSH_HOME={home}\n")
    args = ["--input", str(case), "--output", str(tmp_path / "runs")]
    return args, harness, options


def test_cli_file_stdout_and_env_model(cli, tmp_path, monkeypatch, capsys):
    args, harness, options = cli
    monkeypatch.setenv("EVAL_DSH_MODEL", "from-process")
    env = tmp_path / ".env"
    env.write_text(env.read_text() + "EVAL_DSH_MODEL=from-file\nDEEPSEEK_API_KEY=fake-test-secret\n")
    assert batch.main(args) == 0
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["case_count"] == result["ok_count"] == 1
    output = tmp_path / "runs"
    row = json.loads((output / "results.jsonl").read_text())
    assert row["status"] == "ok"
    assert (output / "sessions" / row["session_id"] / "events.jsonl").is_file()
    assert "SDK startup chatter" in captured.err
    assert "fake-test-secret" not in captured.out + captured.err
    assert options["model"] == "from-file"
    assert options["env"]["EVAL_DSH_MODEL"] == "from-file"
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


def test_cli_uses_fixed_env_and_working_directory(cli, tmp_path, monkeypatch, capsys):
    args, _, options = cli
    monkeypatch.setenv("EVAL_DSH_MODEL", "process-model")
    other = tmp_path / "other"
    other.mkdir()
    (other / ".env").write_text("EVAL_DSH_MODEL=wrong-directory\n")
    monkeypatch.chdir(other)
    assert batch.main(args) == 0
    capsys.readouterr()
    assert options["model"] == "deepseek-flash"
    assert options["cwd"] == options["runtime_cwd"] == str(tmp_path)


@pytest.mark.parametrize("effort", [None, "off", "low", "high", "max"])
def test_reasoning_effort_config(cli, tmp_path, monkeypatch, effort):
    args, _, options = cli
    monkeypatch.setenv("EVAL_DSH_REASONING_EFFORT", "max")
    if effort is not None:
        env = tmp_path / ".env"
        env.write_text(env.read_text() + f"EVAL_DSH_REASONING_EFFORT={effort}\n")
    assert batch.main(args) == 0
    expected = effort if effort is not None else "high"
    assert options["reasoning_effort"] == expected
    manifest = json.loads((tmp_path / "runs" / "manifest.json").read_text())
    assert manifest["runtime"]["reasoning_effort"] == expected


@pytest.mark.parametrize("effort", ["medium", ""])
def test_invalid_reasoning_effort_before_sdk(cli, tmp_path, capsys, effort):
    args, _, options = cli
    env = tmp_path / ".env"
    env.write_text(env.read_text() + f"EVAL_DSH_REASONING_EFFORT={effort}\n")
    assert batch.main(args) == 2
    assert options == {}
    assert not (tmp_path / "runs").exists()
    assert "EVAL_DSH_REASONING_EFFORT" in capsys.readouterr().err


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
         "--output", str(tmp_path / "run")],
        text=True, capture_output=True, cwd=Path(__file__).resolve().parents[1],
    )
    assert completed.returncode == 2
    assert not completed.stdout
    assert "question must not be blank" in completed.stderr
    assert not (tmp_path / "run").exists()


def test_default_model_and_blank_override(cli, tmp_path, monkeypatch, capsys):
    args, harness, options = cli
    monkeypatch.delenv("EVAL_DSH_MODEL", raising=False)
    assert batch.main(args) == 0
    assert options["model"] == "deepseek-flash"
    manifest = json.loads((tmp_path / "runs" / "manifest.json").read_text())
    assert manifest["runtime"]["model"] == "deepseek-flash"
    assert harness.closed
    capsys.readouterr()
    env = tmp_path / ".env"
    env.write_text(env.read_text() + 'EVAL_DSH_MODEL="   "\n')
    assert batch.main(args) == 2
    assert "Model must not be blank" in capsys.readouterr().err


@pytest.mark.parametrize("missing", ["file", "EVAL_DSH_BIN", "EVAL_DSH_HOME"])
def test_missing_fixed_runtime_configuration(cli, tmp_path, capsys, missing):
    args, _, options = cli
    env = tmp_path / ".env"
    if missing == "file":
        env.unlink()
    else:
        env.write_text("\n".join(line for line in env.read_text().splitlines()
                                 if not line.startswith(missing + "=")) + "\n")
    assert batch.main(args) == 2
    assert options == {}
    assert not (tmp_path / "runs").exists()
    assert (".env.example" if missing == "file" else missing) in capsys.readouterr().err


@pytest.mark.parametrize("mode", [None, "extract", "direct", " direct "])
def test_read_mode_config_and_resume(cli, tmp_path, monkeypatch, capsys, mode):
    args, _, options = cli
    monkeypatch.setenv("BANSO_WEB_READ_MODE", "invalid-from-process")
    if mode is not None:
        env = tmp_path / ".env"
        env.write_text(env.read_text() + f'BANSO_WEB_READ_MODE="{mode}"\n')
    assert batch.main(args) == 0
    expected = mode.strip() if mode is not None else None
    if mode is None:
        assert "BANSO_WEB_READ_MODE" not in options["env"]
    else:
        assert options["env"]["BANSO_WEB_READ_MODE"] == expected
    assert "read_mode" not in options
    assert "read_mode_override" not in options  # Metadata is not an SDK option.
    manifest = json.loads((tmp_path / "runs" / "manifest.json").read_text())
    assert manifest["runtime"]["read_mode_override"] == expected
    assert batch.main(args + ["--resume"]) == 0
    capsys.readouterr()


@pytest.mark.parametrize("mode", ["", "auto", "DIRECT"])
def test_invalid_read_mode_before_sdk(cli, tmp_path, capsys, mode):
    args, _, options = cli
    env = tmp_path / ".env"
    env.write_text(env.read_text() + f'BANSO_WEB_READ_MODE="{mode}"\n')
    assert batch.main(args) == 2
    assert options == {}
    assert not (tmp_path / "runs").exists()
    assert "BANSO_WEB_READ_MODE" in capsys.readouterr().err


@pytest.mark.parametrize("change", ["mode", "legacy_manifest"])
def test_read_mode_resume_rejects_changes_without_rewriting_results(cli, tmp_path, capsys, change):
    args, _, options = cli
    assert batch.main(args) == 0
    manifest_path = tmp_path / "runs" / "manifest.json"
    if change == "mode":
        env = tmp_path / ".env"
        env.write_text(env.read_text() + "BANSO_WEB_READ_MODE=direct\n")
    else:
        manifest = json.loads(manifest_path.read_text())
        del manifest["runtime"]["read_mode_override"]
        manifest_path.write_text(json.dumps(manifest))
    prior_manifest = manifest_path.read_bytes()
    results_path = tmp_path / "runs" / "results.jsonl"
    prior_results = results_path.read_bytes()
    options.clear()
    assert batch.main(args + ["--resume"]) == 2
    assert "runtime configuration differs" in capsys.readouterr().err
    assert options == {}
    assert manifest_path.read_bytes() == prior_manifest
    assert results_path.read_bytes() == prior_results
