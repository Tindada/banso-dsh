"""Answer one GISA case: SDK research, validated JSON, deterministic TSV."""

import json
import time
import uuid
from pathlib import Path
from typing import Literal

from deepseek_harness import DeepSeekHarness
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
