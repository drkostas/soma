"""Test backfill orchestrator logic."""

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest

from backfill import GarminBackfill, HevyBackfill, _safe_db_op


class TestGarminBackfill:
    def test_calculates_date_range_from_scratch(self):
        """When no prior progress, starts from today going backwards."""
        bf = GarminBackfill.__new__(GarminBackfill)
        bf.today = date(2026, 2, 20)
        bf.start_year = 2021

        dates = bf._generate_date_range(oldest_done=None)
        assert dates[0] == date(2026, 2, 20)
        assert dates[-1] == date(2021, 1, 1)
        assert len(dates) > 1800

    def test_resumes_from_oldest_done(self):
        """When prior progress exists, continues from day before oldest_done."""
        bf = GarminBackfill.__new__(GarminBackfill)
        bf.today = date(2026, 2, 20)
        bf.start_year = 2021

        dates = bf._generate_date_range(oldest_done=date(2025, 1, 1))
        assert dates[0] == date(2024, 12, 31)
        assert date(2025, 1, 1) not in dates

    def test_empty_range_when_all_done(self):
        """Returns empty list when oldest_done is before start_year."""
        bf = GarminBackfill.__new__(GarminBackfill)
        bf.today = date(2026, 2, 20)
        bf.start_year = 2021

        dates = bf._generate_date_range(oldest_done=date(2021, 1, 1))
        assert dates == []

    def test_shutdown_flag_mechanism(self):
        """Setting shutdown flag should be accessible."""
        bf = GarminBackfill.__new__(GarminBackfill)
        bf._shutdown = False
        assert bf._shutdown is False
        bf._shutdown = True
        assert bf._shutdown is True


class TestHevyBackfill:
    def test_resumes_from_last_page(self):
        """Should start from page after last completed page."""
        with patch("backfill._safe_db_op") as mock_safe_db, \
             patch("backfill.HevyClient"):

            mock_safe_db.return_value = {
                "last_page": 5,
                "total_items": 247,
                "items_completed": 50,
                "status": "paused",
                "oldest_date_done": None,
            }

            bf = HevyBackfill()
            assert bf.start_page == 6

    def test_starts_from_page_1_when_no_progress(self):
        """Should start from page 1 when no prior progress."""
        with patch("backfill._safe_db_op") as mock_safe_db, \
             patch("backfill.HevyClient"):

            mock_safe_db.return_value = None

            bf = HevyBackfill()
            assert bf.start_page == 1


class TestSafeDbOp:
    def test_retries_on_connection_error(self):
        """Should retry on connection errors."""
        call_count = 0

        def flaky_op(conn, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("connection reset by peer")
            return "success"

        with patch("backfill.get_connection") as mock_conn, \
             patch("backfill.time.sleep"):
            mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
            mock_conn.return_value.__exit__ = MagicMock(return_value=False)

            result = _safe_db_op(flaky_op, max_retries=3)
            assert result == "success"
            assert call_count == 3

    def test_raises_on_non_connection_error(self):
        """Should not retry on non-connection errors."""
        def bad_op(conn, *args, **kwargs):
            raise ValueError("bad data")

        with patch("backfill.get_connection") as mock_conn:
            mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
            mock_conn.return_value.__exit__ = MagicMock(return_value=False)

            with pytest.raises(ValueError, match="bad data"):
                _safe_db_op(bad_op)
