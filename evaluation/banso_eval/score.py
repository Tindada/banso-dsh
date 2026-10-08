"""Offline scoring against an explicit subset, including missing/failed cases."""
import argparse
import json
import sys
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from .gisa_scoring import GisaAnswerType, GisaCaseScore, SimpleEvaluator, summarize_gisa_scores


class ScoringCase(BaseModel):
    """Scoring needs only identity and type, not question text or SDK state."""

    model_config = ConfigDict(extra="ignore", frozen=True)
    id: int = Field(ge=0, strict=True)
    answer_type: GisaAnswerType


def read_jsonl(path):
    with Path(path).open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def load_cases(path):
    cases = [ScoringCase.model_validate(row) for row in read_jsonl(path)]
    if not cases:
        raise ValueError("No scoring cases found")
    if len({case.id for case in cases}) != len(cases):
        raise ValueError("Duplicate scoring case IDs")
    return cases


def score_results(results_path, cases, answer_dir):
    expected = {case.id: case for case in cases}
    records = {}
    for row in read_jsonl(results_path):
        case_id = row.get("id", row.get("case_id"))
        if type(case_id) is not int or case_id not in expected or case_id in records:
            raise ValueError(f"Invalid, unexpected or duplicate result ID: {case_id}")
        if "id" in row and "case_id" in row and row["id"] != row["case_id"]:
            raise ValueError("Conflicting id and case_id")
        if row["answer_type"] != expected[case_id].answer_type:
            raise ValueError(f"Answer type mismatch: {case_id}")
        prediction = row.get("prediction")
        if prediction is not None and not isinstance(prediction, str):
            raise ValueError("prediction must be string or null")
        if ("status" in row and row["status"] != "ok") or row.get("completed") is False:
            prediction = None
        records[case_id] = prediction
    evaluator = SimpleEvaluator()
    scores = [GisaCaseScore(
        case_id=case.id, answer_type=case.answer_type,
        prediction_present=bool(records.get(case.id)),
        metrics=evaluator.evaluate_one(records.get(case.id), answer_dir / f"{case.id}.csv", case.answer_type),
    ) for case in cases]
    summary = summarize_gisa_scores(scores)
    summary.update(case_count=len(cases), recorded_count=len(records),
                   missing_count=len(cases) - len(records),
                   prediction_count=sum(s.prediction_present for s in scores))
    return scores, summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path)
    parser.add_argument("--cases", type=Path, default=Path("data/gisa/derived/cases_60.jsonl"))
    parser.add_argument("--answer-dir", type=Path, default=Path("data/gisa/raw/answer"))
    parser.add_argument("--source", type=Path, default=Path("data/gisa/source.json"))
    parser.add_argument("--output", type=Path, required=True, help="New directory; never writes into source run")
    args = parser.parse_args(argv)
    try:
        cases = load_cases(args.cases)
        scores, summary = score_results(args.results, cases, args.answer_dir)
        summary["source"] = json.loads(args.source.read_text())
        summary["selected_case_ids"] = [c.id for c in cases]
        summary["results_path"] = str(args.results.resolve())
        args.output.mkdir(parents=True, exist_ok=False)
        (args.output / "scores.jsonl").write_text("".join(s.model_dump_json() + "\n" for s in scores))
        (args.output / "score_summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"Scoring error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
