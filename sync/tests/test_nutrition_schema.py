"""Tests for nutrition_engine.schema — Task 1."""
import re
from unittest.mock import MagicMock

from nutrition_engine.schema import NUTRITION_SCHEMA_SQL, apply_schema


REQUIRED_TABLES = [
    "nutrition_profile",
    "ingredients",
    "preset_meals",
    "nutrition_day",
    "meal_log",
    "drink_log",
    "tdee_history",
]


class TestSchemaSQL:
    """Verify the raw SQL string contains all required DDL."""

    def test_all_tables_present(self):
        sql_upper = NUTRITION_SCHEMA_SQL.upper()
        for table in REQUIRED_TABLES:
            pattern = rf"CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?{table.upper()}\b"
            assert re.search(pattern, sql_upper), (
                f"Missing CREATE TABLE for '{table}'"
            )

    def test_singleton_constraint_on_nutrition_profile(self):
        """nutrition_profile must have CHECK (id = 1) to enforce singleton."""
        assert "CHECK" in NUTRITION_SCHEMA_SQL.upper()
        assert re.search(r"CHECK\s*\(\s*id\s*=\s*1\s*\)", NUTRITION_SCHEMA_SQL), (
            "Missing CHECK (id = 1) singleton constraint on nutrition_profile"
        )

    def test_schema_is_string(self):
        assert isinstance(NUTRITION_SCHEMA_SQL, str)
        assert len(NUTRITION_SCHEMA_SQL) > 200


class TestApplySchema:
    """Verify apply_schema calls conn.cursor().execute() with the SQL."""

    def test_apply_schema_executes_sql(self):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(
            return_value=mock_cursor
        )
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        apply_schema(mock_conn)

        mock_cursor.execute.assert_called_once_with(NUTRITION_SCHEMA_SQL)
        mock_conn.commit.assert_called_once()
