"""Summarize main-agent and extract-tool token usage from DSH session logs."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

BUCKET_KEYS = (
    "uncached_input_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "output_tokens",
    "total_tokens",
)


def _zero_buckets() -> dict[str, int]:
    return {key: 0 for key in BUCKET_KEYS}


def _nonneg_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _buckets_from_usage(usage: Any) -> dict[str, int] | None:
    if not isinstance(usage, dict):
        return None
    uncached = _nonneg_int(usage.get("inputTokens"))
    output = _nonneg_int(usage.get("outputTokens"))
    if uncached is None or output is None:
        return None
    cache_read = _nonneg_int(usage.get("cacheReadTokens", 0))
    cache_write = _nonneg_int(usage.get("cacheWriteTokens", 0))
    if cache_read is None or cache_write is None:
        return None
    return {
        "uncached_input_tokens": uncached,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
        "output_tokens": output,
        "total_tokens": uncached + cache_read + cache_write + output,
    }


def _add_buckets(target: dict[str, int], delta: dict[str, int], sign: int = 1) -> None:
    for key in BUCKET_KEYS:
        target[key] += sign * delta[key]


def _cache_hit_rate(buckets: dict[str, int]) -> float | None:
    prompt_total = (
        buckets["uncached_input_tokens"]
        + buckets["cache_read_tokens"]
        + buckets["cache_write_tokens"]
    )
    if prompt_total == 0:
        return None
    return round(buckets["cache_read_tokens"] / prompt_total, 4)


def _format_section(count_key: str, count: int, buckets: dict[str, int]) -> dict[str, Any]:
    return {
        count_key: count,
        **buckets,
        "cache_hit_rate": _cache_hit_rate(buckets),
    }


def _format_summary_section(
    count_key: str,
    count: int,
    buckets: dict[str, int],
    counted_cases: int,
) -> dict[str, Any]:
    section = _format_section(count_key, count, buckets)
    if counted_cases > 0:
        section["per_case_mean"] = {
            count_key: round(count / counted_cases, 2),
            **{key: round(buckets[key] / counted_cases, 1) for key in BUCKET_KEYS},
        }
    else:
        section["per_case_mean"] = None
    return section


def _assistant_usage_of(event_type: str, data: dict[str, Any]) -> Any:
    if event_type == "assistant/message" and data.get("usage") is not None:
        return data.get("usage")
    stream = data.get("stream")
    if isinstance(stream, list):
        for chunk in reversed(stream):
            if isinstance(chunk, dict) and chunk.get("type") == "usage":
                return chunk.get("usage")
    return None


def summarize_session_events(
    events_path: Path,
    *,
    session_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Aggregate main-agent and tool-extract token usage for one session event log.

    Main-agent folding mirrors DSH's tokenUsage projection: each assistant/message
    or assistant/attempt contributes its usage; same (turn, step) replaces the
    previous sample unless llm/retry-started cleared the slot.
    """
    main_buckets = _zero_buckets()
    extract_buckets = _zero_buckets()
    main_steps = 0
    extract_calls = 0
    last_main: tuple[int, int, dict[str, int]] | None = None

    with Path(events_path).open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            payload = json.loads(line)
            if (
                session_id is not None
                and isinstance(payload, dict)
                and "sessionId" in payload
                and payload.get("sessionId") != session_id
            ):
                continue
            event = payload.get("event", payload) if isinstance(payload, dict) else None
            if not isinstance(event, dict):
                continue
            event_type = event.get("type")
            data = event.get("data")
            if not isinstance(data, dict):
                continue

            if event_type == "llm/retry-started":
                turn, step = data.get("turn"), data.get("step")
                if last_main is not None and last_main[0] == turn and last_main[1] == step:
                    last_main = None
                continue

            if event_type in ("assistant/message", "assistant/attempt"):
                buckets = _buckets_from_usage(_assistant_usage_of(event_type, data))
                if buckets is None:
                    continue
                turn, step = data.get("turn"), data.get("step")
                if (
                    last_main is not None
                    and last_main[0] == turn
                    and last_main[1] == step
                ):
                    if last_main[2] != buckets:
                        _add_buckets(main_buckets, last_main[2], sign=-1)
                        _add_buckets(main_buckets, buckets, sign=1)
                        last_main = (turn, step, buckets)
                else:
                    _add_buckets(main_buckets, buckets, sign=1)
                    main_steps += 1
                    last_main = (turn, step, buckets)
                continue

            if event_type == "tool/result":
                meta = data.get("meta")
                if isinstance(meta, dict) and "usage" in meta:
                    buckets = _buckets_from_usage(meta.get("usage"))
                    if buckets is not None:
                        _add_buckets(extract_buckets, buckets, sign=1)
                        extract_calls += 1

    combined_buckets = _zero_buckets()
    _add_buckets(combined_buckets, main_buckets, sign=1)
    _add_buckets(combined_buckets, extract_buckets, sign=1)
    return {
        "main": _format_section("steps", main_steps, main_buckets),
        "extract": _format_section("calls", extract_calls, extract_buckets),
        "combined": _format_section("llm_calls", main_steps + extract_calls, combined_buckets),
    }


def summarize_run_token_usage(run_dir: Path) -> dict[str, Any]:
    """Write per-case token_usage.jsonl under run_dir and return the run summary."""
    run_path = Path(run_dir)
    results_path = run_path / "results.jsonl"
    if not results_path.is_file():
        raise FileNotFoundError(f"results.jsonl not found in {run_path}")

    total_main = _zero_buckets()
    total_extract = _zero_buckets()
    total_main_steps = 0
    total_extract_calls = 0
    case_rows: list[dict[str, Any]] = []
    missing_event_count = 0

    with results_path.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            row = json.loads(line)
            case_id = row.get("id", row.get("case_id"))
            session_id = row.get("session_id")
            status = row.get("status")
            events_path = (
                run_path / "sessions" / session_id / "events.jsonl"
                if isinstance(session_id, str) and session_id
                else None
            )
            if events_path is None or not events_path.is_file():
                missing_event_count += 1
                zero = _zero_buckets()
                case_rows.append({
                    "id": case_id,
                    "session_id": session_id,
                    "status": status,
                    "missing_events": True,
                    "main": _format_section("steps", 0, zero),
                    "extract": _format_section("calls", 0, zero),
                    "combined": _format_section("llm_calls", 0, zero),
                })
                continue

            usage = summarize_session_events(events_path, session_id=session_id)
            _add_buckets(total_main, usage["main"], sign=1)
            _add_buckets(total_extract, usage["extract"], sign=1)
            total_main_steps += usage["main"]["steps"]
            total_extract_calls += usage["extract"]["calls"]
            case_rows.append({
                "id": case_id,
                "session_id": session_id,
                "status": status,
                "missing_events": False,
                **usage,
            })

    (run_path / "token_usage.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in case_rows),
        encoding="utf-8",
    )

    total_combined = _zero_buckets()
    _add_buckets(total_combined, total_main, sign=1)
    _add_buckets(total_combined, total_extract, sign=1)
    case_count = len(case_rows)
    counted_case_count = case_count - missing_event_count

    return {
        "case_count": case_count,
        "counted_case_count": counted_case_count,
        "missing_event_count": missing_event_count,
        "main": _format_summary_section("steps", total_main_steps, total_main, counted_case_count),
        "extract": _format_summary_section("calls", total_extract_calls, total_extract, counted_case_count),
        "combined": _format_summary_section(
            "llm_calls",
            total_main_steps + total_extract_calls,
            total_combined,
            counted_case_count,
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path, help="Run directory containing results.jsonl and sessions/")
    args = parser.parse_args(argv)
    try:
        run_dir = args.run_dir.expanduser().resolve()
        token_usage = summarize_run_token_usage(run_dir)
        summary_path = run_dir / "summary.json"
        summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.is_file() else {}
        summary["token_usage"] = token_usage
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(token_usage, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"Token usage error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
