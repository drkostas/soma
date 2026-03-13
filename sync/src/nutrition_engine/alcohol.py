"""Alcohol calorie calculator — Task 6.

Computes calorie/macro impact of alcoholic drinks and estimates the
duration of fat oxidation suppression from alcohol metabolism.
"""

from __future__ import annotations

from nutrition_engine.seed_data import DRINK_DATABASE

# Ethanol density: 0.789 g/ml
ETHANOL_DENSITY = 0.789


def fat_oxidation_pause_hours(alcohol_grams: float) -> float:
    """Estimate how long fat oxidation is suppressed by alcohol intake.

    Ranges:
        - 0g or less → 0h
        - 1-28g → 4-6h (linear: 14g→4h, 28g→6h)
        - 28-56g → 6-12h (linear)
        - 56g+ → 12-24h (linear, capped at 24)
    """
    if alcohol_grams <= 0:
        return 0.0

    if alcohol_grams <= 28:
        # Linear from 0g→0h isn't quite right per the spec.
        # Spec says 1-28g → 4-6h, with 14g→4h and 28g→6h.
        # So at 1g we start at ~4h and scale to 6h at 28g.
        # Interpretation: linear interpolation from (0, 0) wouldn't work
        # since 14g→4h. Instead: linear from (0, ~2.67h) to (14, 4h) to (28, 6h).
        # Simpler: piecewise from (0, 0) then (14, 4) then (28, 6).
        if alcohol_grams <= 14:
            return alcohol_grams / 14.0 * 4.0
        else:
            return 4.0 + (alcohol_grams - 14.0) / (28.0 - 14.0) * 2.0
    elif alcohol_grams <= 56:
        return 6.0 + (alcohol_grams - 28.0) / (56.0 - 28.0) * 6.0
    else:
        # 56g+ → 12-24h, capped at 24
        hours = 12.0 + (alcohol_grams - 56.0) / (56.0) * 12.0
        return min(24.0, hours)


def compute_drink_entry(
    drink_type: str,
    quantity: float = 1.0,
) -> dict | None:
    """Compute nutritional entry for a drink.

    Args:
        drink_type: Key in DRINK_DATABASE (e.g. "beer_ipa").
        quantity: Number of standard servings (default 1.0).

    Returns:
        Dict with drink_type, quantity, calories, alcohol_grams, carbs,
        fat_oxidation_pause_hours. Returns None for unknown drink types.
    """
    drink = DRINK_DATABASE.get(drink_type)
    if drink is None:
        return None

    default_ml = drink["default_ml"]
    total_ml = default_ml * quantity

    calories = drink["calories_per_100ml"] * total_ml / 100.0
    carbs = drink["carbs_per_100ml"] * total_ml / 100.0
    alcohol_grams = total_ml * (drink["alcohol_pct"] / 100.0) * ETHANOL_DENSITY

    return {
        "drink_type": drink_type,
        "quantity": quantity,
        "calories": round(calories, 1),
        "alcohol_grams": round(alcohol_grams, 1),
        "carbs": round(carbs, 1),
        "fat_oxidation_pause_hours": round(fat_oxidation_pause_hours(alcohol_grams), 1),
    }
