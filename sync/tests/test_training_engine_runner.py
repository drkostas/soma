"""Tests for training engine runner transaction isolation.

Verifies that _run_step gives each step its own connection so failures
in one step don't cascade to subsequent steps.
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock
import pytest


def _make_mock_conn():
    """Create a mock psycopg2 connection."""
    conn = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock()
    conn.cursor.return_value.__exit__ = MagicMock()
    return conn


class TestRunStep:
    """Test that _run_step isolates each step with its own connection."""

    @patch("training_engine.runner._fresh_conn")
    def test_success_commits(self, mock_fresh):
        from training_engine.runner import _run_step

        conn = _make_mock_conn()
        mock_fresh.return_value = conn

        def my_step(c):
            return "ok"

        result = _run_step("test", my_step)
        assert result == "ok"
        conn.commit.assert_called_once()
        conn.rollback.assert_not_called()
        conn.close.assert_called_once()

    @patch("training_engine.runner._fresh_conn")
    def test_failure_rolls_back(self, mock_fresh):
        from training_engine.runner import _run_step

        conn = _make_mock_conn()
        mock_fresh.return_value = conn

        def failing_step(c):
            raise ValueError("boom")

        result = _run_step("test", failing_step)
        assert result is None
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()
        conn.close.assert_called_once()

    @patch("training_engine.runner._fresh_conn")
    def test_each_step_gets_own_connection(self, mock_fresh):
        from training_engine.runner import _run_step

        conns = [_make_mock_conn(), _make_mock_conn()]
        mock_fresh.side_effect = conns

        _run_step("step1", lambda c: "a")
        _run_step("step2", lambda c: "b")

        # Each step got its own connection
        assert mock_fresh.call_count == 2
        conns[0].close.assert_called_once()
        conns[1].close.assert_called_once()

    @patch("training_engine.runner._fresh_conn")
    def test_failure_doesnt_block_next_step(self, mock_fresh):
        from training_engine.runner import _run_step

        conn1 = _make_mock_conn()
        conn2 = _make_mock_conn()
        mock_fresh.side_effect = [conn1, conn2]

        # Step 1 fails
        result1 = _run_step("step1", lambda c: (_ for _ in ()).throw(RuntimeError("fail")))
        # Step 2 succeeds with its own fresh connection
        result2 = _run_step("step2", lambda c: "ok")

        assert result1 is None
        assert result2 == "ok"
        conn1.rollback.assert_called_once()
        conn2.commit.assert_called_once()

    @patch("training_engine.runner._fresh_conn")
    def test_extra_args_passed_through(self, mock_fresh):
        from training_engine.runner import _run_step

        conn = _make_mock_conn()
        mock_fresh.return_value = conn

        def step_with_args(c, x, y):
            return x + y

        result = _run_step("test", step_with_args, 3, 4)
        assert result == 7
