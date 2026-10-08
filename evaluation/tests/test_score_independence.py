"""The scoring stage must work without importing preparation or execution."""
import json
import subprocess
import sys

import pytest

from banso_eval.score import load_cases


def test_scoring_without_sdk_or_question_text(tmp_path):
    (tmp_path / "cases.jsonl").write_text('{"id":1,"answer_type":"item"}\n')
    (tmp_path / "results.jsonl").write_text(json.dumps({
        "id": 1, "answer_type": "item", "status": "ok",
        "prediction": "```tsv\nValue\nA\n```",
    }) + "\n")
    (tmp_path / "1.csv").write_text("A\n")
    (tmp_path / "source.json").write_text('{"revision":"test"}')
    # A fresh interpreter ensures previously loaded modules cannot hide a dependency.
    code = '''
import importlib.abc
import runpy
import sys
class BlockExecution(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'deepseek_harness', 'dotenv', 'scripts'} or fullname in {
            'banso_eval.answer', 'banso_eval.batch', 'banso_eval.gisa_format'
        }:
            raise RuntimeError('Unexpected scoring dependency: ' + fullname)
sys.meta_path.insert(0, BlockExecution())
sys.argv = ['banso_eval.score', *sys.argv[1:]]
runpy.run_module('banso_eval.score', run_name='__main__')
'''
    result = subprocess.run([
        sys.executable, "-c", code, str(tmp_path / "results.jsonl"),
        "--cases", str(tmp_path / "cases.jsonl"), "--answer-dir", str(tmp_path),
        "--source", str(tmp_path / "source.json"), "--output", str(tmp_path / "scoring"),
    ], capture_output=True, text=True, check=True)
    assert json.loads(result.stdout)["overall_global_em"] == 1


@pytest.mark.parametrize("rows", [[], [{"id": True, "answer_type": "item"}],
    [{"id": 1, "answer_type": "unknown"}],
    [{"id": 1, "answer_type": "item"}, {"id": 1, "answer_type": "item"}]])
def test_scoring_case_validation(tmp_path, rows):
    path = tmp_path / "cases.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    with pytest.raises(ValueError):
        load_cases(path)
