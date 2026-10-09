"""Run prepared GISA cases sequentially with resumable results."""
import argparse
import hashlib
import json
import os
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

from deepseek_harness import DeepSeekHarness
from dotenv import dotenv_values

from .answer import AnswerResult, GisaCase, answer_case


def _close_harness(harness: DeepSeekHarness) -> None:
    try:
        with redirect_stdout(sys.stderr):
            harness.close()
    except Exception as exc:
        print(f"SDK shutdown warning: {exc}", file=sys.stderr)


EVALUATION_DIR = Path(__file__).resolve().parents[1]


def evaluation_path(path: Path) -> Path:
    path = path.expanduser()
    return (path if path.is_absolute() else EVALUATION_DIR / path).resolve()


def runtime_options() -> dict:
    """Read fixed runtime configuration from evaluation/.env."""
    env_file = EVALUATION_DIR / ".env"
    if not env_file.is_file():
        raise ValueError(f"Create {env_file} from .env.example before running")
    env = {key: value for key, value in dotenv_values(env_file).items() if value is not None}
    for key in ("EVAL_DSH_BIN", "EVAL_DSH_HOME"):
        if not env.get(key, "").strip():
            raise ValueError(f"{key} is required in {env_file}")
    dsh_bin = evaluation_path(Path(env["EVAL_DSH_BIN"]))
    dsh_home = evaluation_path(Path(env["EVAL_DSH_HOME"]))
    profile = env.get("EVAL_DSH_PROFILE", "banso-dsh")
    model = env.get("EVAL_DSH_MODEL", "deepseek-flash").strip()
    reasoning_effort = env.get("EVAL_DSH_REASONING_EFFORT", "high").strip()
    if reasoning_effort not in {"off", "low", "high", "max"}:
        raise ValueError("EVAL_DSH_REASONING_EFFORT must be off, low, high, or max")
    if not dsh_bin.is_file() or not os.access(dsh_bin, os.X_OK):
        raise ValueError(f"DSH executable is missing or not executable: {dsh_bin}")
    if not profile or Path(profile).name != profile or profile in {".", ".."}:
        raise ValueError("EVAL_DSH_PROFILE must be a single directory name")
    if not (dsh_home / "profiles" / profile / "package.json").is_file():
        raise ValueError(f"Profile not installed in {dsh_home}: {profile}")
    if not model:
        raise ValueError("Model must not be blank")
    return dict(dsh_bin=str(dsh_bin), dsh_home=str(dsh_home), profile=profile,
                cwd=str(EVALUATION_DIR), runtime_cwd=str(EVALUATION_DIR), model=model,
                reasoning_effort=reasoning_effort, env=env)



def read_jsonl(path):
    with Path(path).open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_cases(path):
    cases = [GisaCase.model_validate(row) for row in read_jsonl(path)]
    if not cases:
        raise ValueError("No questions found")
    if len({case.id for case in cases}) != len(cases):
        raise ValueError("Duplicate IDs in questions")
    return cases


def load_results(path, cases):
    indexed = {c.id: c for c in cases}
    results = {}
    if Path(path).exists():
        for row in read_jsonl(path):
            result = AnswerResult.model_validate(row)
            if result.id in results or result.id not in indexed:
                raise ValueError(f"Duplicate or unexpected result ID: {result.id}")
            if result.answer_type != indexed[result.id].answer_type:
                raise ValueError(f"Answer type mismatch: {result.id}")
            results[result.id] = result
    return results


def run_cases(harness, cases, output):
    """Skip all recorded attempts, including failures; leave caller SDK open."""
    path = output / "results.jsonl"
    results = load_results(path, cases)
    # A complete last JSON object without a newline is safe to resume.
    if path.exists() and path.stat().st_size:
        with path.open("rb+") as stream:
            stream.seek(-1, 2)
            if stream.read(1) != b"\n":
                stream.write(b"\n")
    with path.open("a", encoding="utf-8") as stream:
        for case in cases:
            if case.id in results:
                continue
            print(f"Answering GISA {case.id} ({case.answer_type.value})", file=sys.stderr)
            result = answer_case(harness, case, runs_dir=output / "sessions")
            stream.write(result.model_dump_json() + "\n")
            stream.flush()
            os.fsync(stream.fileno())
            results[case.id] = result
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/gisa/derived/cases_60.jsonl"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    harness = None
    try:
        input_path = evaluation_path(args.input)
        cases = load_cases(input_path)
        serialized = "".join(c.model_dump_json() + "\n" for c in cases)
        source = json.loads((input_path.parent.parent / "source.json").read_text(encoding="utf-8"))
        spec = {"selected_case_ids": [c.id for c in cases],
                "cases_sha256": hashlib.sha256(serialized.encode()).hexdigest(), "source": source}
        output = evaluation_path(args.output)
        options = runtime_options()
        if args.resume:
            manifest = json.loads((output / "manifest.json").read_text())
            if any(manifest.get(k) != v for k, v in spec.items()):
                raise ValueError("Resume selection or dataset differs from manifest")
            if (output / "cases.jsonl").read_text() != serialized:
                raise ValueError("Saved cases differ from selected questions")
            load_results(output / "results.jsonl", cases)
        else:
            output.mkdir(parents=True, exist_ok=False)
            manifest = dict(spec, created_at=datetime.now(timezone.utc).isoformat(), runtime=None)
            (output / "cases.jsonl").write_text(serialized, encoding="utf-8")
            write_json(output / "manifest.json", manifest)
        runtime = {k: v for k, v in options.items() if k != "env"}
        if manifest["runtime"] is not None and manifest["runtime"] != runtime:
            raise ValueError("Resume runtime configuration differs from manifest")
        manifest["runtime"] = runtime
        write_json(output / "manifest.json", manifest)
        existing = load_results(output / "results.jsonl", cases)
        if len(existing) == len(cases):
            results = existing
        else:
            with redirect_stdout(sys.stderr):
                harness = DeepSeekHarness(**options)
                harness.start()
                results = run_cases(harness, cases, output)
        summary = {"case_count": len(cases), "recorded_count": len(results),
                   "ok_count": sum(r.status == "ok" for r in results.values())}
        write_json(output / "summary.json", summary)
        print(json.dumps(summary))
        return 0 if summary["ok_count"] == len(cases) else 1
    except KeyboardInterrupt:
        print("Interrupted; recorded results retained. Use --resume to continue.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Batch error: {exc}", file=sys.stderr)
        return 2
    finally:
        if harness is not None:
            _close_harness(harness)


if __name__ == "__main__":
    raise SystemExit(main())
