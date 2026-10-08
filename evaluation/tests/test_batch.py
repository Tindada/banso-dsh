import json
import base64
import hashlib
import subprocess
import sys
from types import SimpleNamespace

import pytest

from banso_eval import batch, score
from banso_eval.answer import GisaCase
from scripts.prepare_gisa import select_questions


def save(path, value):
    path.write_text(json.dumps(value))
    return path


@pytest.fixture
def config(tmp_path):
    cases = [dict(id=i, question=f"Question {i}", answer_type="item") for i in (1, 2, 3)]
    (tmp_path / "derived").mkdir()
    questions = tmp_path / "derived" / "questions.jsonl"
    questions.write_text("".join(json.dumps(c) + "\n" for c in cases))
    selection = save(tmp_path / "selection.json", {"selected_case_ids": [3, 1, 2]})
    source = save(tmp_path / "source.json", {"revision": "test"})
    output = tmp_path / "run"
    args = ["--input", str(questions),
            "--output", str(output)]
    return cases, questions, selection, source, output, args


class FakeHarness:
    calls = []
    instances = []
    interrupt_at = None

    def __init__(self, **kwargs):
        self.closed = False
        self.instances.append(self)

    def start(self):
        pass

    def close(self):
        self.closed = True

    def run(self, prompt, *, session_id, on_notification):
        if len(self.calls) == self.interrupt_at:
            raise KeyboardInterrupt
        self.calls.append(session_id)
        return SimpleNamespace(final_response='{"value":"A"}', finish_reason="completed")


@pytest.fixture
def fake(monkeypatch):
    FakeHarness.calls = []
    FakeHarness.instances = []
    FakeHarness.interrupt_at = None
    monkeypatch.setattr(batch, "DeepSeekHarness", FakeHarness)
    monkeypatch.setattr(batch, "runtime_options", lambda: {"model": "test", "env": {"KEY": "secret"}})
    return FakeHarness


def test_selection_errors_and_order(config):
    cases, questions, *_ = config
    selection_path = questions.parent / "pick.json"
    save(selection_path, {"selected_case_ids": [3, 1]})
    assert [c["id"] for c in select_questions(cases, selection_path)] == [3, 1]
    for ids in ([1, 1], [4], [], [True]):
        with pytest.raises(ValueError):
            select_questions(cases, save(selection_path, {"selected_case_ids": ids}))


def test_prepare_subset_without_run_directory(config):
    cases, questions, selection, source, output, args = config
    raw = questions.parent / "raw.jsonl"
    answers = questions.parent / "answers"
    traces = questions.parent / "traces"
    answers.mkdir()
    traces.mkdir()
    encrypted = []
    for case in cases:
        plaintext = case["question"].encode()
        key = hashlib.sha256(b"test").digest()
        ciphertext = base64.b64encode(bytes(v ^ key[i % len(key)] for i, v in enumerate(plaintext))).decode()
        encrypted.append(dict(case, question=ciphertext, canary="test", question_type="stable", topic="test"))
        (answers / f"{case['id']}.csv").write_text("A")
        (traces / f"{case['id']}.json").write_text("{}")
    raw.write_text("".join(json.dumps(c) + "\n" for c in encrypted))
    derived = questions.parent / "derived" / "cases_60.jsonl"
    result = subprocess.run([sys.executable, "scripts/prepare_gisa.py", "--input", str(raw),
                             "--answer-dir", str(answers), "--trace-dir", str(traces),
                             "--selection", str(selection), "--output", str(derived)],
                            capture_output=True, text=True, check=True)
    assert json.loads(result.stdout)["question_count"] == 3
    assert [c.id for c in batch.load_cases(derived)] == [3, 1, 2]
    assert not output.exists()
    missing_output = subprocess.run([
        sys.executable, "scripts/prepare_gisa.py", "--selection", str(selection),
    ], capture_output=True, text=True)
    assert missing_output.returncode == 2
    assert "explicit --output" in missing_output.stderr


def test_refuse_overwrite_and_invalid_input(config, fake):
    _, questions, *_, output, args = config
    execute = args
    output.mkdir()
    assert batch.main(execute) == 2
    assert not fake.instances
    questions.write_text("")
    with pytest.raises(ValueError, match="No questions"):
        batch.load_cases(questions)


def test_interrupt_resume_and_config_guard(config, fake, capsys):
    *_, output, args = config
    execute = args
    fake.interrupt_at = 1
    assert batch.main(execute) == 130
    assert len(batch.read_jsonl(output / "results.jsonl")) == 1
    assert fake.instances[-1].closed
    fake.interrupt_at = None
    assert batch.main(execute + ["--resume"]) == 0
    assert len(fake.calls) == len(set(fake.calls)) == 3
    assert fake.instances[-1].closed
    assert "secret" not in (output / "manifest.json").read_text()
    assert len(list((output / "sessions").glob("*/events.jsonl"))) == 4
    assert batch.main(execute + ["--resume"]) == 0
    assert len(fake.calls) == 3
    manifest = json.loads((output / "manifest.json").read_text())
    manifest["runtime"]["model"] = "different"
    save(output / "manifest.json", manifest)
    assert batch.main(execute + ["--resume"]) == 2


def test_failed_attempt_is_not_retried_and_truncated_result_rejected(config, fake):
    cases, *_, output, args = config
    output.mkdir()
    parsed = [GisaCase.model_validate(c) for c in cases]
    class Failed(FakeHarness):
        def run(self, *a, **kw):
            raise RuntimeError("broken")
    first = batch.run_cases(Failed(), parsed, output)
    assert all(r.status == "runtime_error" for r in first.values())
    batch.run_cases(fake(), parsed, output)
    assert not fake.calls
    with (output / "results.jsonl").open("a") as f:
        f.write('{"id":')
    with pytest.raises(ValueError):
        batch.run_cases(fake(), parsed, output)


def test_scoring_missing_failed_and_legacy(config):
    cases, *_, output, args = config
    truth = output.parent / "truth"
    truth.mkdir()
    for c in cases:
        (truth / f"{c['id']}.csv").write_text("A\n")
    results = output.parent / "results.jsonl"
    rows = [{"case_id": 1, "answer_type": "item", "prediction": "```tsv\nValue\nA\n```"},
            {"id": 2, "answer_type": "item", "status": "format_error", "prediction": "```tsv\nValue\nA\n```"}]
    results.write_text("".join(json.dumps(r) + "\n" for r in rows))
    scores, summary = score.score_results(results, [GisaCase.model_validate(c) for c in cases], truth)
    assert summary["overall_global_em"] == pytest.approx(1 / 3)
    assert summary["case_count"] == 3
    assert summary["missing_count"] == 1
    assert [s.prediction_present for s in scores] == [True, False, False]
    results.write_text(json.dumps(rows[0]) + "\n" + json.dumps(rows[0]))
    with pytest.raises(ValueError, match="duplicate"):
        score.score_results(results, [GisaCase.model_validate(c) for c in cases], truth)


def test_score_cli(config, capsys):
    cases, questions, selection, source, output, _ = config
    truth = output.parent / "answers"
    truth.mkdir()
    for c in cases:
        (truth / f"{c['id']}.csv").write_text("A\n")
    results = output.parent / "empty.jsonl"
    results.write_text("")
    args = [str(results), "--cases", str(questions),
            "--source", str(source), "--answer-dir", str(truth), "--output", str(output)]
    assert score.main(args) == 0
    assert json.loads(capsys.readouterr().out)["missing_count"] == 3
    assert len(batch.read_jsonl(output / "scores.jsonl")) == 3
    assert score.main(args) == 2
