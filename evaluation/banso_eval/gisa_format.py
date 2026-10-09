"""Pure GISA output adapters, adapted from BansoAgain's benchmark adapters.

No research runtime, model calls, or ground-truth access belongs in this module.
"""

import csv
import json
from enum import StrEnum
from io import StringIO
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class AnswerType(StrEnum):
    ITEM = "item"
    SET = "set"
    LIST = "list"
    TABLE = "table"


NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
CellText = Annotated[str, StringConstraints(strip_whitespace=True)]
Scalar = NonBlank | int | float | bool
Cell = CellText | int | float | bool | None


class StrictOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ItemOutput(StrictOutput):
    value: Scalar


class ItemsOutput(StrictOutput):
    items: list[Scalar]


class TableOutput(StrictOutput):
    columns: list[NonBlank] = Field(min_length=1)
    rows: list[list[Cell]]


def _reject_constant(value: str) -> None:
    raise ValueError(f"Invalid JSON constant: {value}")


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON field: {key}")
        result[key] = value
    return result


def parse_and_render(answer_type: AnswerType, content: str) -> str:
    """Decode the first JSON object, validate it, and render a TSV block.

    Start at the first opening brace and ignore surrounding prose or fences.
    Never skip an invalid first object to look for a later valid answer.
    """
    answer_type = AnswerType(answer_type)
    start = content.find("{")
    if start < 0:
        raise ValueError("No JSON object found in final answer")
    decoder = json.JSONDecoder(
        parse_constant=_reject_constant, object_pairs_hook=_unique_object
    )
    value, _ = decoder.raw_decode(content, start)
    if answer_type == AnswerType.ITEM:
        output = ItemOutput.model_validate(value)
        headers, rows = ["Value"], [[output.value]]
    elif answer_type in {AnswerType.SET, AnswerType.LIST}:
        output = ItemsOutput.model_validate(value)
        items = output.items
        if answer_type == AnswerType.SET:
            items = list(dict.fromkeys(str(item) for item in items))
        headers, rows = ["Item"], [[item] for item in items]
    else:
        output = TableOutput.model_validate(value)
        headers, rows = output.columns, output.rows
        if len(set(headers)) != len(headers):
            raise ValueError("Table column names must be unique")
        if any(len(row) != len(headers) for row in rows):
            raise ValueError("Every table row must match the number of columns")

    buffer = StringIO(newline="")
    writer = csv.writer(buffer, delimiter="\t", lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(["" if cell is None else str(cell) for cell in row] for row in rows)
    return f"```tsv\n{buffer.getvalue()}```"


def build_prompt(question: str, answer_type: AnswerType) -> str:
    schemas = {
        AnswerType.ITEM: '{"value": "<requested value>"}',
        AnswerType.SET: '{"items": ["<matching item>", "<another matching item>"]}',
        AnswerType.LIST: '{"items": ["<first item>", "<second item>"]}',
        AnswerType.TABLE: '{"columns": ["<column name>"], "rows": [["<value>"]]}',
    }
    return (
        f"Question:\n{question}\n\n"
        "Final answer requirements:\n"
        "Research the question using the available search and reading tools as needed. "
        "Base your answer on the collected evidence; do not invent missing facts. "
        "These requirements apply to the final answer, not intermediate tool calls. "
        "Return exactly one JSON object, without Markdown fences, citations, source "
        "labels, explanations, or confidence notes. Return only the requested values "
        "and fields, without unrequested titles or other embellishments. "
        "Every textual value must be in English; use standard English names where "
        "available, otherwise translate descriptive terms and conventionally "
        "transliterate proper names. Do not invent aliases or expand abbreviations. "
        "Use JSON strings for textual and numeric values. Follow the question's "
        "scope, eligibility, time frame, exact column names, value formats and sorting "
        "rules. Include all supported matching results. For sets order is insignificant; "
        "for lists preserve the requested order and meaningful duplicates. "
        "For tables every row must have the same number of cells as columns.\n"
        f"Answer type: {answer_type.value}\nRequired JSON structure: {schemas[answer_type]}"
    )
