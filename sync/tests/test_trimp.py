"""Tests for TRIMP computation."""
from training_engine.load_stream import compute_trimp


def test_trimp_basic():
    """TRIMP for a 30-min run at 150 bpm, resting 50, max 190."""
    trimp = compute_trimp(
        duration_min=30, avg_hr=150, resting_hr=50, max_hr=190
    )
    # ΔHR ratio = (150-50)/(190-50) = 100/140 ≈ 0.714
    # TRIMP = 30 * 0.714 * 0.64 * e^(1.92 * 0.714) ≈ 54.2
    assert 50 < trimp < 60


def test_trimp_zero_duration():
    """Zero duration -> 0 TRIMP."""
    trimp = compute_trimp(duration_min=0, avg_hr=150, resting_hr=50, max_hr=190)
    assert trimp == 0.0


def test_trimp_hr_equals_resting():
    """HR at rest -> 0 delta -> minimal TRIMP."""
    trimp = compute_trimp(duration_min=30, avg_hr=50, resting_hr=50, max_hr=190)
    assert trimp < 1.0


def test_trimp_missing_hr():
    """Missing HR data -> None."""
    trimp = compute_trimp(duration_min=30, avg_hr=None, resting_hr=50, max_hr=190)
    assert trimp is None


def test_trimp_high_intensity():
    """High intensity should produce higher TRIMP due to exponential."""
    low = compute_trimp(duration_min=30, avg_hr=130, resting_hr=50, max_hr=190)
    high = compute_trimp(duration_min=30, avg_hr=170, resting_hr=50, max_hr=190)
    assert high > low * 2
