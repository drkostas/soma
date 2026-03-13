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

    def test_nutrition_profile_has_all_columns(self):
        """nutrition_profile must contain every column from the design doc."""
        required_columns = [
            "weight_kg",
            "height_cm",
            "age",
            "sex",
            "activity_level",
            "goal",
            "target_calories",
            "target_protein",
            "target_carbs",
            "target_fat",
            "target_fiber",
            "estimated_bf_pct",
            "estimated_ffm_kg",
            "target_bf_pct",
            "target_date",
            "tdee_estimate",
            "tdee_confidence",
            "daily_deficit",
            "protein_g_per_kg",
            "fat_g_per_kg",
            "step_goal",
            "creatine_dose_g",
            "creatine_start_date",
            "creatine_dose_change_date",
            "updated_at",
        ]
        sql_lower = NUTRITION_SCHEMA_SQL.lower()
        for col in required_columns:
            assert col.lower() in sql_lower, (
                f"Missing column '{col}' in nutrition_profile"
            )

    def test_no_ffm_kg_column(self):
        """Old ffm_kg column must be renamed to estimated_ffm_kg."""
        # Match ffm_kg as a standalone column name (not part of estimated_ffm_kg)
        matches = re.findall(r'\bffm_kg\b', NUTRITION_SCHEMA_SQL)
        assert len(matches) == 0, (
            "Found bare 'ffm_kg' in schema — should be 'estimated_ffm_kg'"
        )

    def test_tdee_estimate_is_real(self):
        """tdee_estimate must be REAL, not INTEGER."""
        match = re.search(r'tdee_estimate\s+(\w+)', NUTRITION_SCHEMA_SQL)
        assert match is not None, "tdee_estimate column not found"
        assert match.group(1).upper() == "REAL", (
            f"tdee_estimate should be REAL, got {match.group(1)}"
        )

    def test_daily_deficit_is_real(self):
        """daily_deficit must be REAL, not INTEGER."""
        match = re.search(r'daily_deficit\s+(\w+)', NUTRITION_SCHEMA_SQL)
        assert match is not None, "daily_deficit column not found"
        assert match.group(1).upper() == "REAL", (
            f"daily_deficit should be REAL, got {match.group(1)}"
        )


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
