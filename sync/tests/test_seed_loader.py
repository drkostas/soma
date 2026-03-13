"""Tests for nutrition_engine.seed_loader — Task 7."""
from nutrition_engine.seed_loader import (
    build_ingredient_insert_sql,
    build_preset_insert_sql,
)
from nutrition_engine.seed_data import INGREDIENTS, PRESET_MEALS


class TestBuildIngredientInsertSql:
    def test_contains_insert_into_ingredients(self):
        sql = build_ingredient_insert_sql(INGREDIENTS)
        assert "INSERT INTO ingredients" in sql

    def test_contains_on_conflict_upsert(self):
        sql = build_ingredient_insert_sql(INGREDIENTS)
        assert "ON CONFLICT (id) DO UPDATE" in sql

    def test_contains_chicken_breast_raw(self):
        sql = build_ingredient_insert_sql(INGREDIENTS)
        assert "chicken_breast_raw" in sql


class TestBuildPresetInsertSql:
    def test_contains_insert_into_preset_meals(self):
        sql = build_preset_insert_sql(PRESET_MEALS, INGREDIENTS)
        assert "INSERT INTO preset_meals" in sql

    def test_contains_eggs_avocado_toast(self):
        sql = build_preset_insert_sql(PRESET_MEALS, INGREDIENTS)
        assert "Eggs & Avocado Toast" in sql

    def test_contains_protein_oats(self):
        sql = build_preset_insert_sql(PRESET_MEALS, INGREDIENTS)
        assert "Protein Oats" in sql
