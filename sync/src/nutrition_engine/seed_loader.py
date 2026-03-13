"""Seed data loader — Task 7.

Builds SQL statements to upsert ingredients and preset meals into the database,
and provides seed_database() to execute the full seeding in one call.
"""

from __future__ import annotations

import json
from typing import Any

from nutrition_engine.calculator import compute_meal_macros
from nutrition_engine.seed_data import INGREDIENTS, PRESET_MEALS


def build_ingredient_insert_sql(ingredients: dict[str, dict[str, Any]]) -> str:
    """Build a single INSERT ... ON CONFLICT(id) DO UPDATE for all ingredients.

    Args:
        ingredients: The ingredient database mapping id -> ingredient dict.

    Returns:
        SQL string with a multi-row INSERT statement.
    """
    rows: list[str] = []
    for ing_id, ing in ingredients.items():
        # Escape single quotes in names
        name = ing["name"].replace("'", "''")
        raw_to_cooked = (
            str(ing["raw_to_cooked_ratio"])
            if ing["raw_to_cooked_ratio"] is not None
            else "NULL"
        )
        category = f"'{ing['category']}'" if ing.get("category") else "NULL"

        rows.append(
            f"('{ing_id}', '{name}', "
            f"{ing['calories_per_100g']}, {ing['protein_per_100g']}, "
            f"{ing['carbs_per_100g']}, {ing['fat_per_100g']}, "
            f"{ing['fiber_per_100g']}, {ing['is_raw']}, "
            f"{raw_to_cooked}, {category})"
        )

    values = ",\n  ".join(rows)

    return (
        f"INSERT INTO ingredients "
        f"(id, name, calories_per_100g, protein_per_100g, carbs_per_100g, "
        f"fat_per_100g, fiber_per_100g, is_raw, raw_to_cooked_ratio, category)\n"
        f"VALUES\n  {values}\n"
        f"ON CONFLICT (id) DO UPDATE SET\n"
        f"  calories_per_100g = EXCLUDED.calories_per_100g,\n"
        f"  protein_per_100g  = EXCLUDED.protein_per_100g,\n"
        f"  carbs_per_100g    = EXCLUDED.carbs_per_100g,\n"
        f"  fat_per_100g      = EXCLUDED.fat_per_100g,\n"
        f"  fiber_per_100g    = EXCLUDED.fiber_per_100g,\n"
        f"  is_raw            = EXCLUDED.is_raw,\n"
        f"  raw_to_cooked_ratio = EXCLUDED.raw_to_cooked_ratio,\n"
        f"  category          = EXCLUDED.category;"
    )


def build_preset_insert_sql(
    presets: dict[str, dict[str, Any]],
    ingredients: dict[str, dict[str, Any]],
) -> str:
    """Build INSERT for all presets with pre-computed macro totals.

    Uses compute_meal_macros to compute calories/protein/carbs/fat/fiber
    for each preset, embedding them as top-level fields in the items JSONB.

    Args:
        presets: The preset meal database mapping id -> preset dict.
        ingredients: The ingredient database (for macro computation).

    Returns:
        SQL string with a multi-row INSERT statement.
    """
    rows: list[str] = []
    for preset_id, preset in presets.items():
        macros = compute_meal_macros(preset["items"], ingredients)
        name = preset["name"].replace("'", "''")

        # Build the JSONB payload: items + macro totals
        items_payload = {
            "items": preset["items"],
            "calories": round(macros["calories"], 1),
            "protein": round(macros["protein"], 1),
            "carbs": round(macros["carbs"], 1),
            "fat": round(macros["fat"], 1),
            "fiber": round(macros["fiber"], 1),
        }
        items_json = json.dumps(items_payload).replace("'", "''")

        # tags as PostgreSQL array literal
        tags = preset.get("tags", [])
        tags_literal = "ARRAY[" + ", ".join(f"'{t}'" for t in tags) + "]::text[]"

        rows.append(f"('{preset_id}', '{name}', '{items_json}', {tags_literal})")

    values = ",\n  ".join(rows)

    return (
        f"INSERT INTO preset_meals (id, name, items, tags)\n"
        f"VALUES\n  {values}\n"
        f"ON CONFLICT (id) DO UPDATE SET\n"
        f"  name  = EXCLUDED.name,\n"
        f"  items = EXCLUDED.items,\n"
        f"  tags  = EXCLUDED.tags;"
    )


def seed_database(conn) -> None:
    """Seed the database with ingredients and preset meals.

    1. Upsert all ingredients from seed_data.INGREDIENTS.
    2. Delete existing system presets (clean slate).
    3. Insert all presets from seed_data.PRESET_MEALS with computed macros.

    Args:
        conn: A DB-API 2.0 connection (e.g. psycopg2).
    """
    ingredient_sql = build_ingredient_insert_sql(INGREDIENTS)
    preset_sql = build_preset_insert_sql(PRESET_MEALS, INGREDIENTS)

    with conn.cursor() as cur:
        cur.execute(ingredient_sql)
        # Delete existing system presets before re-inserting
        preset_ids = list(PRESET_MEALS.keys())
        placeholders = ", ".join(f"'{pid}'" for pid in preset_ids)
        cur.execute(f"DELETE FROM preset_meals WHERE id IN ({placeholders})")
        cur.execute(preset_sql)

    conn.commit()
