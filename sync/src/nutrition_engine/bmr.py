"""Basal Metabolic Rate (BMR) formulas.

Cunningham 1980 primary for FFM-based (most accurate for trained athletes,
validated by ten Haaf 2014 with 78% accuracy in recreational athletes).

ten Haaf 2014 weight-based as fallback when FFM is unknown (~80% accuracy
for athlete populations, better than Mifflin for lean trained).

Mifflin-St Jeor 1990 as absolute fallback (best for general/obese adults).

DO NOT use Garmin-reported BMR — no published validation, known to inflate
by ~13% through an embedded ~1.1 sedentary activity multiplier.
"""

from __future__ import annotations

from typing import Literal


def cunningham(ffm_kg: float) -> int:
    """Cunningham 1980: BMR = 500 + 22 × FFM_kg.

    Primary formula for trained athletes. Validated by ten Haaf 2014
    (PMID 25275434, DOI 10.1371/journal.pone.0108460).
    """
    if ffm_kg <= 0:
        raise ValueError(f"ffm_kg must be positive, got {ffm_kg}")
    return round(500 + 22 * ffm_kg)


def mifflin_st_jeor(
    weight_kg: float,
    height_cm: float,
    age: int,
    sex: Literal["male", "female"],
) -> int:
    """Mifflin-St Jeor 1990: demographic-based BMR.

    Best for general/obese populations. Under-predicts in lean trained men
    because it ignores FFM.

    Reference: Frankenfield 2005, DOI 10.1016/j.jada.2005.02.005
    """
    if weight_kg <= 0 or height_cm <= 0 or age <= 0:
        raise ValueError("weight_kg, height_cm, and age must all be positive")
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age
    if sex == "male":
        return round(base + 5)
    return round(base - 161)


def ten_haaf_weight(
    weight_kg: float,
    height_cm: float,
    age: int,
    sex: Literal["male", "female"],
) -> int:
    """ten Haaf 2014 weight-based REE formula for recreational athletes.

    Better than Mifflin-St Jeor for trained populations (~80% accuracy).
    Reference: ten Haaf & Weijs 2014, PMID 25275434, DOI 10.1371/journal.pone.0108460

    Formula (Table 3, kcal output):
        REE = 11.936·w + 587.728·(h_m) - 8.129·a + 191.027·(sex_male) + 29.279

    where h_m = height in meters and sex_male = 1 for male, 0 for female.
    """
    if weight_kg <= 0 or height_cm <= 0 or age <= 0:
        raise ValueError("weight_kg, height_cm, and age must all be positive")

    height_m = height_cm / 100.0
    sex_male = 1 if sex == "male" else 0

    ree_kcal = (
        11.936 * weight_kg
        + 587.728 * height_m
        - 8.129 * age
        + 191.027 * sex_male
        + 29.279
    )
    return round(ree_kcal)


def compute_bmr(
    ffm_kg: float | None = None,
    weight_kg: float | None = None,
    height_cm: float | None = None,
    age: int | None = None,
    sex: Literal["male", "female"] | None = None,
) -> int:
    """Route to the best BMR formula given available inputs.

    Priority:
    1. Cunningham (FFM-based) — if ``ffm_kg`` provided
    2. ten Haaf weight-based — if demographics provided
    3. (Mifflin-St Jeor is available as a secondary fallback but ten Haaf
       is preferred for athletic populations; callers explicitly invoke
       ``mifflin_st_jeor`` if they want it.)
    """
    if ffm_kg is not None:
        return cunningham(ffm_kg=ffm_kg)

    if weight_kg is not None and height_cm is not None and age is not None and sex is not None:
        return ten_haaf_weight(
            weight_kg=weight_kg, height_cm=height_cm, age=age, sex=sex,
        )

    raise ValueError(
        "compute_bmr requires either ffm_kg or full demographics "
        "(weight_kg + height_cm + age + sex)"
    )
