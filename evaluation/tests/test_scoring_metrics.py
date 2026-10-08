"""Tests for deterministic offline GISA scoring."""

from pathlib import Path

import pytest

from banso_eval.gisa_scoring import GisaAnswerType, SimpleEvaluator


def test_gisa_item_and_set_metrics(tmp_path: Path) -> None:
    evaluator = SimpleEvaluator()
    item_truth = tmp_path / "item.csv"
    item_truth.write_text("0.5\n", encoding="utf-8")
    assert evaluator.evaluate_one(
        "```tsv\nValue\n50%\n```",
        item_truth,
        GisaAnswerType.ITEM,
    ) == {"item_em": 1, "global_em": 1}

    set_truth = tmp_path / "set.csv"
    set_truth.write_text("A\nB\n", encoding="utf-8")
    assert evaluator.evaluate_one(
        "```tsv\nItem\nA\nC\nA\n```",
        set_truth,
        GisaAnswerType.SET,
    ) == {
        "set_precision": 0.5,
        "set_recall": 0.5,
        "set_f1": 0.5,
        "global_em": 0,
    }


def test_gisa_list_metrics_preserve_duplicates_and_order(tmp_path: Path) -> None:
    truth = tmp_path / "list.csv"
    truth.write_text("A\nB\nA\n", encoding="utf-8")

    metrics = SimpleEvaluator().evaluate_one(
        "```tsv\nItem\nA\nA\nB\n```",
        truth,
        GisaAnswerType.LIST,
    )

    assert metrics == {
        "list_content_f1": 1.0,
        "list_order_score": 0.6667,
        "global_em": 0,
    }


def test_gisa_table_metrics_use_common_columns_and_column_value_items(
    tmp_path: Path,
) -> None:
    truth = tmp_path / "table.csv"
    truth.write_text("Name,Year\nA,1\nB,2\n", encoding="utf-8")

    metrics = SimpleEvaluator().evaluate_one(
        "```tsv\nYear\tName\tExtra\n1\tA\tx\n3\tC\ty\n```",
        truth,
        GisaAnswerType.TABLE,
    )

    assert metrics == {
        "table_row_f1": 0.5,
        "table_row_precision": 0.5,
        "table_row_recall": 0.5,
        "table_item_f1": 0.4,
        "table_item_precision": pytest.approx(1 / 3),
        "table_item_recall": 0.5,
        "global_em": 0,
    }

