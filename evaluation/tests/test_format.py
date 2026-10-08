import csv
from io import StringIO

import pytest

from banso_eval.gisa_format import AnswerType, build_prompt, parse_and_render


@pytest.mark.parametrize("kind,raw,expected", [
    ("item", '{"value":"  Answer  "}', "Value\nAnswer\n"),
    ("item", '{"value":true}', "Value\nTrue\n"),
    ("set", '{"items":["A","B","A",1,"1"]}', "Item\nA\nB\n1\n"),
    ("list", '{"items":["B","A","B"]}', "Item\nB\nA\nB\n"),
    ("set", '{"items":[]}', "Item\n"),
    ("table", '{"columns":["Name","Year"],"rows":[["A",2024],["B",null]]}',
     "Name\tYear\nA\t2024\nB\t\n"),
    ("table", '{"columns":["Name"],"rows":[]}', "Name\n"),
])
def test_original_conversion_semantics(kind, raw, expected):
    assert parse_and_render(AnswerType(kind), raw) == f"```tsv\n{expected}```"


def test_cells_roundtrip_through_csv_quoting():
    result = parse_and_render(AnswerType.TABLE,
        '{"columns":["Text","Empty"],"rows":[["a\\tb\\n\\\"c\\\"",""]]}')
    rows = list(csv.reader(StringIO(result[len("```tsv\n"):-3]), delimiter="\t"))
    assert rows == [["Text", "Empty"], ['a\tb\n"c"', ""]]


@pytest.mark.parametrize("kind,raw", [
    ("item", '```json\n{"value":"A"}\n```'),
    ("item", 'Explanation: {"value":"A"}'),
    ("item", '{"value":"A","extra":1}'),
    ("item", '{"value":" "}'),
    ("item", '{"value":null}'),
    ("item", '{"items":["A"]}'),
    ("item", '{"value":NaN}'),
    ("item", '{"value":1e999}'),
    ("item", '{"value":"A","value":"B"}'),
    ("set", '{"items":[{}]}'),
    ("table", '{"columns":["A"," A "],"rows":[]}'),
    ("table", '{"columns":[],"rows":[]}'),
    ("table", '{"columns":[" "],"rows":[]}'),
    ("table", '{"columns":["A","B"],"rows":[["x"]]}'),
])
def test_invalid_answers_are_not_repaired(kind, raw):
    with pytest.raises(ValueError):
        parse_and_render(AnswerType(kind), raw)


def test_prompt_preserves_question_and_does_not_contain_ground_truth():
    question = "  A question\nwith formatting.  "
    assert question in build_prompt(question, AnswerType.TABLE)
