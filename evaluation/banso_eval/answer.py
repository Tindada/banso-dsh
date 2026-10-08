"""Answer one GISA case: SDK research, validated JSON, deterministic TSV."""

import argparse
import json
import os
import sys
import time
import uuid
from contextlib import redirect_stdout
from pathlib import Path
from typing import Literal

from deepseek_harness import DeepSeekHarness
from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .gisa_format import AnswerType, build_prompt, parse_and_render


class GisaCase(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    id: int = Field(ge=0, strict=True)
    question: str
    answer_type: AnswerType

    @field_validator("question")
    @classmethod
    def nonblank_question(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("question must not be blank")
        return value  # Preserve the original text, including whitespace.


class AnswerResult(BaseModel):
    id: int
    answer_type: AnswerType
    status: Literal[
        "ok", "runtime_error", "incomplete", "empty_answer", "format_error"
    ]
    prediction: str | None = None
    raw_answer: str | None = None
    session_id: str
    finish_reason: str | None = None
    elapsed_seconds: float
    error: str | None = None


def answer_case(
    harness: DeepSeekHarness,
    case: GisaCase | dict,
    *,
    runs_dir: Path = Path("runs"),
) -> AnswerResult:
    """Use a fresh session; keep the caller's SDK alive and log received events.

    Invalid inputs raise before SDK invocation. Execution/format failures become
    results. The event file contains session.event payloads, including sessionId.
    """
    case = GisaCase.model_validate(case)
    session_id = f"gisa-{uuid.uuid4().hex}"
    started = time.monotonic()
    raw_answer = None
    finish_reason = None
    prediction = None
    error = None
    status = "runtime_error"
    try:
        run_dir = Path(runs_dir) / session_id
        run_dir.mkdir(parents=True, exist_ok=False)
        with (run_dir / "events.jsonl").open("x", encoding="utf-8") as event_file:
            def capture(notification):
                nonlocal raw_answer, finish_reason
                if notification.method != "session.event":
                    return
                payload = notification.payload
                event_file.write(json.dumps(payload, ensure_ascii=False) + "\n")
                event_file.flush()
                if payload.get("sessionId") != session_id:
                    return
                event = payload.get("event", {})
                data = event.get("data", {})
                if event.get("type") == "assistant/message":
                    message = data.get("message", data)
                    raw_answer = "".join(
                        block.get("text", "") for block in message.get("content", [])
                        if block.get("type") == "text"
                    )
                elif event.get("type") == "turn/end":
                    finish_reason = data.get("reason", {}).get("kind")

            result = harness.run(
                build_prompt(case.question, case.answer_type),
                session_id=session_id,
                on_notification=capture,
            )
        raw_answer = result.final_response
        finish_reason = result.finish_reason
        if finish_reason != "completed":
            status, error = "incomplete", f"Turn ended with reason: {finish_reason}"
        elif not raw_answer.strip():
            status, error = "empty_answer", "Final answer is empty"
        else:
            try:
                prediction = parse_and_render(case.answer_type, raw_answer)
                status = "ok"
            except ValueError as exc:
                status, error = "format_error", str(exc)
    except Exception as exc:
        status, error = "runtime_error", f"{type(exc).__name__}: {exc}"

    return AnswerResult(
        id=case.id, answer_type=case.answer_type, status=status,
        prediction=prediction, raw_answer=raw_answer, session_id=session_id,
        finish_reason=finish_reason, elapsed_seconds=time.monotonic() - started,
        error=error,
    )


def _close_harness(harness: DeepSeekHarness) -> None:
    try:
        with redirect_stdout(sys.stderr):
            harness.close()
    except Exception as exc:
        print(f"SDK shutdown warning: {exc}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Single case JSON file, or - for stdin")
    parser.add_argument("--dsh-bin", required=True, type=Path)
    parser.add_argument("--dsh-home", required=True, type=Path)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--profile", default="banso-dsh")
    parser.add_argument("--model")
    parser.add_argument("--cwd", type=Path, default=Path.cwd())
    parser.add_argument("--runs-dir", type=Path, default=Path("runs"))
    args = parser.parse_args(argv)
    harness = None
    try:
        text = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8")
        case = GisaCase.model_validate_json(text)
        dsh_bin = args.dsh_bin.expanduser().resolve()
        dsh_home = args.dsh_home.expanduser().resolve()
        cwd = args.cwd.expanduser().resolve()
        if not dsh_bin.is_file() or not os.access(dsh_bin, os.X_OK):
            raise ValueError(f"DSH executable is missing or not executable: {dsh_bin}")
        if not cwd.is_dir():
            raise ValueError(f"Working directory not found: {cwd}")
        if not args.profile or Path(args.profile).name != args.profile or args.profile in {".", ".."}:
            raise ValueError("profile must be a single directory name")
        if not (dsh_home / "profiles" / args.profile / "package.json").is_file():
            raise ValueError(f"Profile not installed in {dsh_home}: {args.profile}")
        env = {}
        if args.env_file is not None:
            env_file = args.env_file.expanduser().resolve()
            if not env_file.is_file():
                raise ValueError(f"Environment file not found: {env_file}")
            env = {key: value for key, value in dotenv_values(env_file).items() if value is not None}
        model = args.model or env.get("DSH_MODEL") or os.getenv("DSH_MODEL") or "deepseek-v4-flash"
        with redirect_stdout(sys.stderr):
            harness = DeepSeekHarness(
                dsh_bin=str(dsh_bin), dsh_home=str(dsh_home), profile=args.profile,
                cwd=str(cwd), runtime_cwd=str(cwd), model=model, env=env,
            )
            harness.start()
    except (KeyboardInterrupt, SystemExit):
        if harness is not None:
            _close_harness(harness)
        raise
    except Exception as exc:
        # Startup/configuration failures do not represent an attempted question.
        print(f"Configuration/startup error: {exc}", file=sys.stderr)
        if harness is not None:
            _close_harness(harness)
        return 2

    try:
        print(f"Answering GISA {case.id} ({case.answer_type.value})", file=sys.stderr)
        with redirect_stdout(sys.stderr):
            result = answer_case(harness, case, runs_dir=args.runs_dir.expanduser().resolve())
    finally:
        _close_harness(harness)
    print(result.model_dump_json())
    return 0 if result.status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
