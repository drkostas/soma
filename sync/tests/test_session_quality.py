from training_engine.session_quality import compute_session_quality


def test_perfect_execution():
    """Running exactly at planned pace/HR = quality 1.0."""
    result = compute_session_quality(
        planned_pace_sec_km=300, actual_pace_sec_km=300,
        planned_hr=150, actual_hr=150,
    )
    assert result == 1.0


def test_faster_than_planned():
    """Running faster with lower HR = quality > 1.0."""
    result = compute_session_quality(
        planned_pace_sec_km=300, actual_pace_sec_km=280,
        planned_hr=150, actual_hr=145,
    )
    assert result > 1.0


def test_slower_than_planned():
    """Running slower with higher HR = quality < 1.0."""
    result = compute_session_quality(
        planned_pace_sec_km=300, actual_pace_sec_km=320,
        planned_hr=150, actual_hr=160,
    )
    assert result < 1.0


def test_missing_hr_uses_pace_only():
    """When HR is missing, use only pace quality."""
    result = compute_session_quality(
        planned_pace_sec_km=300, actual_pace_sec_km=285,
        planned_hr=None, actual_hr=None,
    )
    assert result > 1.0


def test_rest_day_returns_none():
    """Rest days have no session quality."""
    result = compute_session_quality(
        planned_pace_sec_km=0, actual_pace_sec_km=0,
        planned_hr=None, actual_hr=None,
    )
    assert result is None
