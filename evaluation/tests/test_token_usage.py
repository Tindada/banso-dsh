import json
from pathlib import Path

from banso_eval import token_usage


def _write_events(path: Path, events: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events),
        encoding="utf-8",
    )


def _envelope(session_id: str, event_type: str, data: dict) -> dict:
    return {"sessionId": session_id, "event": {"type": event_type, "data": data}}


def test_session_events_combines_main_and_extract_and_filters_session(tmp_path):
    sid = "gisa-s1"
    events_path = tmp_path / "events.jsonl"
    _write_events(
        events_path,
        [
            _envelope(
                sid,
                "assistant/message",
                {
                    "turn": 1,
                    "step": 1,
                    "usage": {
                        "inputTokens": 200,
                        "cacheReadTokens": 800,
                        "cacheWriteTokens": 0,
                        "outputTokens": 100,
                        "totalTokens": 1100,
                    },
                },
            ),
            # Other session events should be ignored.
            _envelope(
                "gisa-other",
                "assistant/message",
                {
                    "turn": 1,
                    "step": 1,
                    "usage": {"inputTokens": 9999, "outputTokens": 9999},
                },
            ),
            # Extract tool result carrying exact API usage in meta.usage.
            _envelope(
                sid,
                "tool/result",
                {
                    "meta": {
                        "mode": "extract",
                        "usage": {
                            "inputTokens": 500,
                            "cacheReadTokens": 0,
                            "cacheWriteTokens": 0,
                            "outputTokens": 50,
                            "totalTokens": 550,
                        },
                    }
                },
            ),
            # Direct tool result without usage should not count as extract.
            _envelope(sid, "tool/result", {"meta": {"mode": "direct"}}),
            # assistant/attempt with usage in stream chunks.
            _envelope(
                sid,
                "assistant/attempt",
                {
                    "turn": 1,
                    "step": 2,
                    "stream": [
                        {"type": "text", "text": "partial"},
                        {
                            "type": "usage",
                            "usage": {
                                "inputTokens": 300,
                                "cacheReadTokens": 700,
                                "outputTokens": 150,
                            },
                        },
                    ],
                },
            ),
        ],
    )

    result = token_usage.summarize_session_events(events_path, session_id=sid)
    assert result["main"] == {
        "steps": 2,
        "uncached_input_tokens": 500,
        "cache_read_tokens": 1500,
        "cache_write_tokens": 0,
        "output_tokens": 250,
        "total_tokens": 2250,
        "cache_hit_rate": 0.75,
    }
    assert result["extract"] == {
        "calls": 1,
        "uncached_input_tokens": 500,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "output_tokens": 50,
        "total_tokens": 550,
        "cache_hit_rate": 0.0,
    }
    assert result["combined"] == {
        "llm_calls": 3,
        "uncached_input_tokens": 1000,
        "cache_read_tokens": 1500,
        "cache_write_tokens": 0,
        "output_tokens": 300,
        "total_tokens": 2800,
        "cache_hit_rate": 0.6,
    }


def test_retry_started_accumulates_while_same_step_without_retry_replaces(tmp_path):
    sid = "gisa-retry"
    events_path = tmp_path / "events.jsonl"
    _write_events(
        events_path,
        [
            # First sample for (1, 1)
            _envelope(
                sid,
                "assistant/attempt",
                {
                    "turn": 1,
                    "step": 1,
                    "stream": [{"type": "usage", "usage": {"inputTokens": 100, "outputTokens": 20}}],
                },
            ),
            # Final settlement for same (1, 1) without retry-started -> replaces previous sample
            _envelope(
                sid,
                "assistant/message",
                {
                    "turn": 1,
                    "step": 1,
                    "usage": {"inputTokens": 120, "outputTokens": 30},
                },
            ),
            # Retry clears the slot so the next (1, 1) adds on top
            _envelope(sid, "llm/retry-started", {"turn": 1, "step": 1}),
            _envelope(
                sid,
                "assistant/message",
                {
                    "turn": 1,
                    "step": 1,
                    "usage": {"inputTokens": 150, "outputTokens": 40},
                },
            ),
        ],
    )

    result = token_usage.summarize_session_events(events_path, session_id=sid)
    assert result["main"]["steps"] == 2
    assert result["main"]["uncached_input_tokens"] == 270
    assert result["main"]["output_tokens"] == 70
    assert result["main"]["total_tokens"] == 340


def test_run_summary_handles_missing_events_and_cli_preserves_summary_fields(tmp_path, capsys):
    run_dir = tmp_path / "run_001"
    run_dir.mkdir()
    (run_dir / "results.jsonl").write_text(
        "\n".join(
            [
                json.dumps({"id": 1, "session_id": "gisa-1", "status": "ok"}),
                json.dumps({"id": 2, "session_id": "gisa-2", "status": "runtime_error"}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    _write_events(
        run_dir / "sessions" / "gisa-1" / "events.jsonl",
        [
            _envelope(
                "gisa-1",
                "assistant/message",
                {
                    "turn": 1,
                    "step": 1,
                    "usage": {"inputTokens": 100, "cacheReadTokens": 100, "outputTokens": 50},
                },
            ),
            _envelope(
                "gisa-1",
                "tool/result",
                {"meta": {"usage": {"inputTokens": 40, "outputTokens": 10}}},
            ),
        ],
    )
    (run_dir / "summary.json").write_text(
        json.dumps({"case_count": 2, "recorded_count": 2, "ok_count": 1}),
        encoding="utf-8",
    )

    assert token_usage.main([str(run_dir)]) == 0
    stdout_usage = json.loads(capsys.readouterr().out)
    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    assert summary["case_count"] == 2
    assert summary["ok_count"] == 1
    assert summary["token_usage"] == stdout_usage
    assert stdout_usage["case_count"] == 2
    assert stdout_usage["counted_case_count"] == 1
    assert stdout_usage["missing_event_count"] == 1
    assert stdout_usage["combined"]["total_tokens"] == 300
    # Mean divides by counted_case_count (1), not total case_count (2).
    assert stdout_usage["combined"]["per_case_mean"]["total_tokens"] == 300.0

    rows = [
        json.loads(line)
        for line in (run_dir / "token_usage.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(rows) == 2
    assert rows[0]["id"] == 1 and rows[0]["missing_events"] is False
    assert rows[1]["id"] == 2 and rows[1]["missing_events"] is True
    assert rows[1]["combined"]["total_tokens"] == 0


def test_cli_returns_error_when_results_missing(tmp_path, capsys):
    assert token_usage.main([str(tmp_path)]) == 2
    assert "results.jsonl not found" in capsys.readouterr().err


def test_batch_writes_token_usage_and_summary(tmp_path, monkeypatch, capsys):
    from banso_eval import batch
    from test_answer import CASE, FakeHarness

    monkeypatch.setattr(batch, "EVALUATION_DIR", tmp_path)
    binary = tmp_path / "dsh"
    binary.write_text("#!/bin/sh\nexit 0\n")
    binary.chmod(0o755)
    home = tmp_path / "home"
    profile = home / "profiles" / "banso-dsh"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text("{}")
    (tmp_path / "derived").mkdir()
    case_path = tmp_path / "derived" / "case.jsonl"
    case_path.write_text(json.dumps(CASE) + "\n", encoding="utf-8")
    (tmp_path / "source.json").write_text('{"revision":"test"}', encoding="utf-8")
    (tmp_path / ".env").write_text(f"EVAL_DSH_BIN={binary}\nEVAL_DSH_HOME={home}\n", encoding="utf-8")

    class UsageHarness(FakeHarness):
        def run(self, prompt, *, session_id, on_notification=None):
            result = super().run(prompt, session_id=session_id, on_notification=on_notification)
            if on_notification is not None:
                from types import SimpleNamespace

                on_notification(
                    SimpleNamespace(
                        method="session.event",
                        payload=_envelope(
                            session_id,
                            "assistant/message",
                            {
                                "turn": 1,
                                "step": 1,
                                "usage": {"inputTokens": 80, "cacheReadTokens": 20, "outputTokens": 10},
                            },
                        ),
                    )
                )
                on_notification(
                    SimpleNamespace(
                        method="session.event",
                        payload=_envelope(
                            session_id,
                            "tool/result",
                            {"meta": {"usage": {"inputTokens": 30, "outputTokens": 5}}},
                        ),
                    )
                )
            return result

    monkeypatch.setattr(batch, "DeepSeekHarness", lambda **kwargs: UsageHarness())
    output = tmp_path / "runs"
    assert batch.main(["--input", str(case_path), "--output", str(output)]) == 0
    out_summary = json.loads(capsys.readouterr().out)
    assert out_summary["token_usage"]["main"]["total_tokens"] == 110
    assert out_summary["token_usage"]["extract"]["total_tokens"] == 35
    assert out_summary["token_usage"]["combined"]["total_tokens"] == 145
    assert (output / "token_usage.jsonl").is_file()
    saved_summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
    assert saved_summary["token_usage"] == out_summary["token_usage"]
