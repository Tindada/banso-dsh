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


def runtime_options(args) -> dict:
    """Validate explicit runtime paths and resolve environment/model precedence."""
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
    return dict(dsh_bin=str(dsh_bin), dsh_home=str(dsh_home), profile=args.profile,
                cwd=str(cwd), runtime_cwd=str(cwd), model=model, env=env)



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
    parser.add_argument("--source", type=Path, default=Path("data/gisa/source.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dsh-bin", type=Path, required=True)
    parser.add_argument("--dsh-home", type=Path, required=True)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--profile", default="banso-dsh")
    parser.add_argument("--model")
    parser.add_argument("--cwd", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    harness = None
    try:
        cases = load_cases(args.input)
        serialized = "".join(c.model_dump_json() + "\n" for c in cases)
        source = json.loads(args.source.read_text())
        spec = {"selected_case_ids": [c.id for c in cases],
                "cases_sha256": hashlib.sha256(serialized.encode()).hexdigest(), "source": source}
        output = args.output.expanduser().resolve()
        options = runtime_options(args)
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
