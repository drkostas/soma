"""Tests for Banister impulse-response model fitting."""

import math

import pytest

from training_engine.banister import (
    BanisterParams,
    banister_predict,
    detect_anchor_runs,
    fit_banister,
)


# ===============================
# ANCHOR DETECTION
# ===============================


class TestDetectAnchorRuns:
    """Test maximal-effort anchor detection from run history."""

    def _make_run(self, avg_hr, distance_m, duration_s, date="2025-06-01"):
        return {
            "date": date,
            "avg_hr": avg_hr,
            "distance_m": distance_m,
            "duration_s": duration_s,
        }

    def test_high_hr_run_detected(self):
        """Runs with avg_hr > 90% HRmax are detected as anchors."""
        hrmax = 190
        runs = [
            self._make_run(avg_hr=175, distance_m=5000, duration_s=1500),  # 92% HRmax
        ]
        anchors = detect_anchor_runs(runs, estimated_hrmax=hrmax)
        assert len(anchors) == 1

    def test_low_hr_run_excluded(self):
        """Easy runs (low HR) are not anchors."""
        hrmax = 190
        runs = [
            self._make_run(avg_hr=140, distance_m=10000, duration_s=3600),  # 74% HRmax
        ]
        anchors = detect_anchor_runs(runs, estimated_hrmax=hrmax)
        assert len(anchors) == 0

    def test_short_run_excluded_even_high_hr(self):
        """Runs < 2km excluded even with high HR (sprints, warm-ups)."""
        hrmax = 190
        runs = [
            self._make_run(avg_hr=180, distance_m=800, duration_s=180),  # high HR but short
        ]
        anchors = detect_anchor_runs(runs, estimated_hrmax=hrmax)
        assert len(anchors) == 0

    def test_mixed_runs_filters_correctly(self):
        """Only qualifying runs survive filtering."""
        hrmax = 190
        runs = [
            self._make_run(avg_hr=175, distance_m=5000, duration_s=1500, date="2025-06-01"),  # anchor
            self._make_run(avg_hr=140, distance_m=10000, duration_s=3600, date="2025-06-02"),  # easy
            self._make_run(avg_hr=180, distance_m=800, duration_s=180, date="2025-06-03"),  # short
            self._make_run(avg_hr=172, distance_m=10000, duration_s=3000, date="2025-06-04"),  # anchor
        ]
        anchors = detect_anchor_runs(runs, estimated_hrmax=hrmax)
        assert len(anchors) == 2

    def test_anchors_have_vdot(self):
        """Each detected anchor should have a computed VDOT value."""
        hrmax = 190
        runs = [
            self._make_run(avg_hr=175, distance_m=5000, duration_s=1500),
        ]
        anchors = detect_anchor_runs(runs, estimated_hrmax=hrmax)
        assert len(anchors) == 1
        assert "vdot" in anchors[0]
        assert anchors[0]["vdot"] > 0

    def test_anchors_sorted_by_date(self):
        """Returned anchors should be sorted by date ascending."""
        hrmax = 190
        runs = [
            self._make_run(avg_hr=175, distance_m=5000, duration_s=1500, date="2025-07-01"),
            self._make_run(avg_hr=178, distance_m=5000, duration_s=1450, date="2025-06-01"),
            self._make_run(avg_hr=172, distance_m=8000, duration_s=2400, date="2025-06-15"),
        ]
        anchors = detect_anchor_runs(runs, estimated_hrmax=hrmax)
        dates = [a["date"] for a in anchors]
        assert dates == sorted(dates)

    def test_custom_hr_threshold(self):
        """Custom HR threshold works. 95% threshold excludes borderline 91% run."""
        hrmax = 190
        runs = [
            self._make_run(avg_hr=173, distance_m=5000, duration_s=1500),  # 91% — passes 90%, fails 95%
            self._make_run(avg_hr=182, distance_m=5000, duration_s=1400),  # 96% — passes both
        ]
        anchors_90 = detect_anchor_runs(runs, estimated_hrmax=hrmax, hr_threshold_pct=0.90)
        anchors_95 = detect_anchor_runs(runs, estimated_hrmax=hrmax, hr_threshold_pct=0.95)
        assert len(anchors_90) == 2
        assert len(anchors_95) == 1

    def test_empty_runs(self):
        """Empty run list returns empty anchors."""
        anchors = detect_anchor_runs([], estimated_hrmax=190)
        assert anchors == []

    def test_boundary_hr_exact_threshold(self):
        """Run at exactly 90% HRmax is included (>= threshold)."""
        hrmax = 200
        runs = [
            self._make_run(avg_hr=180, distance_m=5000, duration_s=1500),  # exactly 90%
        ]
        anchors = detect_anchor_runs(runs, estimated_hrmax=hrmax, hr_threshold_pct=0.90)
        assert len(anchors) == 1

    def test_boundary_distance_exactly_2km(self):
        """Run at exactly 2000m is included (>= min_distance)."""
        hrmax = 190
        runs = [
            self._make_run(avg_hr=175, distance_m=2000, duration_s=600),
        ]
        anchors = detect_anchor_runs(runs, estimated_hrmax=hrmax, min_distance_m=2000)
        assert len(anchors) == 1


# ===============================
# BANISTER PREDICT
# ===============================


class TestBanisterPredict:
    """Test the Banister impulse-response prediction model."""

    def test_no_training_returns_baseline(self):
        """With no training load, prediction equals p0."""
        params = BanisterParams(p0=45.0, k1=1.0, k2=1.5, tau1=42, tau2=7)
        result = banister_predict(params, daily_loads=[], target_day=30)
        assert result == pytest.approx(45.0)

    def test_consistent_training_raises_performance(self):
        """Consistent training should push performance above baseline."""
        params = BanisterParams(p0=45.0, k1=0.1, k2=0.05, tau1=42, tau2=7)
        # Daily training for 60 days with moderate load
        daily_loads = [(d, 50.0) for d in range(60)]
        result = banister_predict(params, daily_loads, target_day=60)
        assert result > params.p0

    def test_taper_after_training_improves_performance(self):
        """Tapering (rest after a training block) should yield higher performance
        than during peak training, because fatigue decays faster than fitness."""
        params = BanisterParams(p0=45.0, k1=0.1, k2=0.15, tau1=42, tau2=7)
        # 40 days of training, then rest
        daily_loads = [(d, 80.0) for d in range(40)]
        # Performance at end of training block
        at_peak = banister_predict(params, daily_loads, target_day=40)
        # Performance 14 days into taper (no training days 40-54)
        at_taper = banister_predict(params, daily_loads, target_day=54)
        assert at_taper > at_peak

    def test_prediction_changes_with_target_day(self):
        """Predictions should differ for different target days."""
        params = BanisterParams(p0=45.0, k1=0.1, k2=0.05, tau1=42, tau2=7)
        daily_loads = [(d, 50.0) for d in range(30)]
        day_30 = banister_predict(params, daily_loads, target_day=30)
        day_60 = banister_predict(params, daily_loads, target_day=60)
        # After stopping training, performance eventually returns to baseline
        # so day_60 should be closer to p0 than day_30
        assert day_30 != day_60

    def test_single_training_impulse(self):
        """A single training impulse should create a fitness-fatigue response."""
        params = BanisterParams(p0=45.0, k1=1.0, k2=2.0, tau1=42, tau2=7)
        daily_loads = [(0, 100.0)]
        # Right after: fatigue dominates (k2 > k1)
        day_1 = banister_predict(params, daily_loads, target_day=1)
        # Later: fatigue has decayed more than fitness
        day_21 = banister_predict(params, daily_loads, target_day=21)
        assert day_21 > day_1

    def test_heavy_fatigue_dips_below_baseline(self):
        """With k2 >> k1, heavy training can push performance below baseline."""
        params = BanisterParams(p0=45.0, k1=0.01, k2=0.5, tau1=42, tau2=7)
        daily_loads = [(d, 100.0) for d in range(10)]
        result = banister_predict(params, daily_loads, target_day=10)
        assert result < params.p0


# ===============================
# FIT BANISTER
# ===============================


class TestFitBanister:
    """Test Banister model parameter fitting via differential evolution."""

    def _generate_synthetic_data(self, true_params, n_days=120, n_anchors=8):
        """Generate synthetic training data and anchor VDOT observations."""
        daily_loads = [(d, 60.0 + 20.0 * math.sin(d / 14.0 * math.pi)) for d in range(n_days)]
        # Create anchors at regular intervals
        anchors = []
        for i in range(n_anchors):
            day = 15 + i * (n_days - 15) // n_anchors
            vdot = banister_predict(true_params, daily_loads, target_day=day)
            anchors.append({"day_index": day, "vdot": vdot})
        return daily_loads, anchors

    def test_fitted_params_reasonable_tau_ranges(self):
        """Fitted tau1 should be 20-80 and tau2 should be 3-20."""
        true_params = BanisterParams(p0=45.0, k1=0.05, k2=0.08, tau1=42, tau2=7)
        daily_loads, anchors = self._generate_synthetic_data(true_params, n_days=180, n_anchors=12)
        fitted = fit_banister(daily_loads, anchors, max_iterations=500)
        assert 20 <= fitted.tau1 <= 80
        assert 3 <= fitted.tau2 <= 20

    def test_few_anchors_returns_defaults(self):
        """With fewer than 2 anchors, returns prior-heavy defaults (tau1~42, tau2~7)."""
        daily_loads = [(d, 50.0) for d in range(60)]
        # Only 1 anchor
        anchors = [{"day_index": 30, "vdot": 46.0}]
        fitted = fit_banister(daily_loads, anchors)
        assert fitted.tau1 == pytest.approx(42, abs=1)
        assert fitted.tau2 == pytest.approx(7, abs=1)

    def test_zero_anchors_returns_defaults(self):
        """Zero anchors returns defaults."""
        daily_loads = [(d, 50.0) for d in range(60)]
        fitted = fit_banister(daily_loads, [])
        assert fitted.tau1 == pytest.approx(42, abs=1)
        assert fitted.tau2 == pytest.approx(7, abs=1)

    def test_k1_k2_positive(self):
        """Fitted k1 and k2 should both be positive."""
        true_params = BanisterParams(p0=45.0, k1=0.05, k2=0.08, tau1=42, tau2=7)
        daily_loads, anchors = self._generate_synthetic_data(true_params, n_days=180, n_anchors=12)
        fitted = fit_banister(daily_loads, anchors, max_iterations=500)
        assert fitted.k1 > 0
        assert fitted.k2 > 0

    def test_p0_in_bounds(self):
        """Fitted p0 should be within the optimization bounds [35, 55]."""
        true_params = BanisterParams(p0=45.0, k1=0.05, k2=0.08, tau1=42, tau2=7)
        daily_loads, anchors = self._generate_synthetic_data(true_params, n_days=180, n_anchors=12)
        fitted = fit_banister(daily_loads, anchors, max_iterations=500)
        assert 35 <= fitted.p0 <= 55

    def test_recovers_known_parameters(self):
        """With clean synthetic data, should recover params close to the true values."""
        true_params = BanisterParams(p0=45.0, k1=0.05, k2=0.08, tau1=42, tau2=7)
        daily_loads, anchors = self._generate_synthetic_data(true_params, n_days=200, n_anchors=15)
        fitted = fit_banister(daily_loads, anchors, max_iterations=1000)
        # Allow reasonable tolerance — DE may find equivalent solutions
        assert abs(fitted.p0 - true_params.p0) < 5
        assert abs(fitted.tau1 - true_params.tau1) < 20
        assert abs(fitted.tau2 - true_params.tau2) < 10

    def test_few_anchors_three(self):
        """With exactly 3 anchors (< 4), should still fit but stay near defaults."""
        true_params = BanisterParams(p0=45.0, k1=0.05, k2=0.08, tau1=42, tau2=7)
        daily_loads, anchors = self._generate_synthetic_data(true_params, n_days=120, n_anchors=3)
        fitted = fit_banister(daily_loads, anchors, max_iterations=500)
        # Should still produce valid params in bounds
        assert 20 <= fitted.tau1 <= 80
        assert 3 <= fitted.tau2 <= 20
        assert fitted.k1 > 0
        assert fitted.k2 > 0
