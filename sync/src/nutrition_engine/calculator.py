"""Nutrition calculator — Task 3.

Computes macro totals from ingredient lists and preset meals.
"""

from __future__ import annotations

from typing import Any


def compute_meal_macros(
    items: list[dict[str, Any]],
    ingredients: dict[str, dict[str, Any]],
    multiplier: float = 1.0,
) -> dict[str, Any]:
    """Compute macro totals for a list of ingredient items.

    Args:
        items: List of dicts with ``ingredient_id`` and ``grams``.
        ingredients: The ingredient database (e.g. ``seed_data.INGREDIENTS``).
        multiplier: Scale factor applied to all values (default 1.0).

    Returns:
        Dict with ``calories``, ``protein``, ``carbs``, ``fat``, ``fiber``,
        and ``items`` (per-item breakdown list).

    Raises:
        KeyError: If an ingredient_id is not found in the database.
    """
    totals = {
        "calories": 0.0,
        "protein": 0.0,
        "carbs": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "items": [],
    }

    for item in items:
        ing_id = item["ingredient_id"]
        grams = item["grams"]

        ing = ingredients[ing_id]  # raises KeyError if unknown
        scale = (grams / 100.0) * multiplier

        item_calories = ing["calories_per_100g"] * scale
        item_protein = ing["protein_per_100g"] * scale
        item_carbs = ing["carbs_per_100g"] * scale
        item_fat = ing["fat_per_100g"] * scale
        item_fiber = ing["fiber_per_100g"] * scale

        totals["calories"] += item_calories
        totals["protein"] += item_protein
        totals["carbs"] += item_carbs
        totals["fat"] += item_fat
        totals["fiber"] += item_fiber

        totals["items"].append(
            {
                "ingredient_id": ing_id,
                "name": ing["name"],
                "grams": grams * multiplier,
                "calories": item_calories,
                "protein": item_protein,
                "carbs": item_carbs,
                "fat": item_fat,
                "fiber": item_fiber,
            }
        )

    return totals


def compute_preset_totals(
    presets: dict[str, dict[str, Any]],
    ingredients: dict[str, dict[str, Any]],
) -> dict[str, dict[str, float]]:
    """Compute macro totals for every preset meal.

    Args:
        presets: The preset meal database (e.g. ``seed_data.PRESET_MEALS``).
        ingredients: The ingredient database.

    Returns:
        Dict mapping preset_id to macro totals
        (``calories``, ``protein``, ``carbs``, ``fat``, ``fiber``).
    """
    result = {}
    for preset_id, preset in presets.items():
        macros = compute_meal_macros(preset["items"], ingredients)
        result[preset_id] = {
            "name": preset["name"],
            "calories": macros["calories"],
            "protein": macros["protein"],
            "carbs": macros["carbs"],
            "fat": macros["fat"],
            "fiber": macros["fiber"],
        }
    return result
