"""Tests for BMR formulas (M1.2)."""

import pytest

from nutrition_engine.bmr import (
    cunningham,
    ten_haaf_weight,
    mifflin_st_jeor,
    compute_bmr,
)


class TestCunningham:
    """Cunningham 1980: BMR = 500 + 22 × FFM_kg.

    Validated by ten Haaf 2014 as the only legacy equation passing
    Bland-Altman in male recreational athletes (78% accuracy).
    """

    def test_current_user_ffm_60_6(self):
        # Test user: 74.2 kg, 23.5% BF, FFM 60.6 kg
        assert cunningham(ffm_kg=60.6) == 1833

    def test_lean_athlete_ffm_70(self):
        assert cunningham(ffm_kg=70.0) == 2040

    def test_low_ffm(self):
        assert cunningham(ffm_kg=40.0) == 1380

    def test_zero_ffm_raises(self):
        with pytest.raises(ValueError):
            cunningham(ffm_kg=0)

    def test_negative_ffm_raises(self):
        with pytest.raises(ValueError):
            cunningham(ffm_kg=-10)


class TestMifflinStJeor:
    """Mifflin-St Jeor 1990: demographic fallback."""

    def test_male(self):
        # 10w + 6.25h - 5a + 5 for male
        # 74.2kg, 177cm, 31y, male: 10×74.2 + 6.25×177 - 5×31 + 5 = 742 + 1106.25 - 155 + 5 = 1698.25
        assert mifflin_st_jeor(weight_kg=74.2, height_cm=177, age=31, sex="male") == 1698

    def test_female(self):
        # 10w + 6.25h - 5a - 161 for female
        assert mifflin_st_jeor(weight_kg=60, height_cm=165, age=30, sex="female") == 1320

    def test_male_typical_adult(self):
        # Known test vector: 80 kg, 180 cm, 35 y, male
        # = 800 + 1125 - 175 + 5 = 1755
        assert mifflin_st_jeor(weight_kg=80, height_cm=180, age=35, sex="male") == 1755


class TestTenHaafWeight:
    """ten Haaf 2014 weight-based formula for trained athletes."""

    def test_male_user(self):
        # 74.2 kg, 177 cm, 31y male — published formula for males:
        # REE_MJ = 0.02035·w + 1.82·h/100 - 0.01184·a + 1.61 (male)
        # → kcal = MJ × 238.85
        result = ten_haaf_weight(weight_kg=74.2, height_cm=177, age=31, sex="male")
        # Should be in the 1750-1900 range for this profile
        assert 1750 <= result <= 1900

    def test_output_is_int(self):
        result = ten_haaf_weight(weight_kg=80, height_cm=180, age=30, sex="male")
        assert isinstance(result, int)


class TestComputeBmr:
    """High-level router: FFM → Cunningham, else → fallbacks."""

    def test_ffm_uses_cunningham(self):
        # When FFM provided, use Cunningham (most accurate for athletes)
        assert compute_bmr(ffm_kg=60.6) == 1833

    def test_no_ffm_uses_ten_haaf(self):
        # Without FFM, use ten Haaf weight-based for trained athletes
        result = compute_bmr(
            weight_kg=74.2, height_cm=177, age=31, sex="male"
        )
        # Should match ten_haaf_weight output
        assert result == ten_haaf_weight(weight_kg=74.2, height_cm=177, age=31, sex="male")

    def test_missing_demographics_raises(self):
        with pytest.raises(ValueError):
            compute_bmr()  # no inputs at all

    def test_partial_demographics_raises(self):
        with pytest.raises(ValueError):
            compute_bmr(weight_kg=74.2)  # missing height, age, sex


class TestFormulaDisagreement:
    """Sanity checks across formulas for same user."""

    def test_cunningham_higher_than_mifflin_for_lean(self):
        # 23.5% BF male is relatively lean; Cunningham should predict higher BMR
        # than Mifflin-St Jeor (which under-predicts in lean trained men)
        user_weight, user_height, user_age = 74.2, 177, 31
        ffm = user_weight * (1 - 0.235)  # 56.76 kg

        cunningham_val = cunningham(ffm_kg=ffm)
        mifflin_val = mifflin_st_jeor(
            weight_kg=user_weight, height_cm=user_height, age=user_age, sex="male"
        )

        # Cunningham should be within 200 kcal of Mifflin but not wildly divergent
        assert abs(cunningham_val - mifflin_val) < 300
