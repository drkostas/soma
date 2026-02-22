"""Tests for FIT file generation."""

import os
import tempfile

from fit_generator import generate_fit, _calc_calories


SAMPLE_HEVY_WORKOUT = {
    "id": "test-workout-001",
    "title": "Push Day",
    "start_time": "2026-02-20T10:00:00Z",
    "end_time": "2026-02-20T11:00:00Z",
    "exercises": [
        {
            "title": "Bench Press (Barbell)",
            "exercise_template_id": "tmpl_001",
            "superset_id": None,
            "notes": None,
            "sets": [
                {"type": "warmup", "weight_kg": 40.0, "reps": 10},
                {"type": "normal", "weight_kg": 70.0, "reps": 8},
                {"type": "normal", "weight_kg": 70.0, "reps": 8},
            ],
        },
        {
            "title": "Lateral Raise (Dumbbell)",
            "exercise_template_id": "tmpl_002",
            "superset_id": None,
            "notes": None,
            "sets": [
                {"type": "normal", "weight_kg": 10.0, "reps": 12},
            ],
        },
    ],
}

SAMPLE_HR = [110, 115, 120, 125, 130]


def test_generate_fit_with_hr():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "test.fit")
        result = generate_fit(
            hevy_workout=SAMPLE_HEVY_WORKOUT,
            hr_samples=SAMPLE_HR,
            output_path=path,
        )
        assert os.path.exists(path)
        assert os.path.getsize(path) > 100
        assert result["exercises"] == 2
        assert result["total_sets"] == 4
        assert result["hr_samples"] == 5
        assert result["avg_hr"] == 120
        assert result["calories"] > 0


def test_generate_fit_without_hr():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "no_hr.fit")
        result = generate_fit(
            hevy_workout=SAMPLE_HEVY_WORKOUT,
            hr_samples=None,
            output_path=path,
        )
        assert os.path.exists(path)
        assert result["hr_samples"] == 0
        assert result["avg_hr"] is None
        # Calories still calculated using default HR
        assert result["calories"] > 0


def test_generate_fit_with_static_hr():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "static_hr.fit")
        result = generate_fit(
            hevy_workout=SAMPLE_HEVY_WORKOUT,
            hr_samples=[95] * 30,
            output_path=path,
        )
        assert os.path.exists(path)
        assert result["hr_samples"] == 30
        assert result["avg_hr"] == 95
        assert result["calories"] > 0


def test_calc_calories_with_hr():
    # 60 min at 100 bpm, age ~32
    cals = _calc_calories([100] * 30, 3600.0, 2026)
    # At 100 bpm: ~6.7 cal/min * 60 min = ~401
    assert 350 < cals < 450


def test_calc_calories_without_hr():
    # Falls back to _DEFAULT_HR_BPM = 90
    cals = _calc_calories([], 3600.0, 2026)
    # At 90 bpm: ~5.2 cal/min * 60 min = ~310
    assert 250 < cals < 370


def test_calc_calories_scales_with_duration():
    cals_30 = _calc_calories([100], 1800.0, 2026)
    cals_60 = _calc_calories([100], 3600.0, 2026)
    assert abs(cals_60 - 2 * cals_30) <= 1
