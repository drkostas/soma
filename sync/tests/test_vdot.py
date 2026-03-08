"""Tests for the Daniels/Gilbert VDOT formula engine."""

import pytest

from training_engine.vdot import (
    _vo2_cost,
    _vo2_demand_fraction,
    vdot_from_race,
    velocity_at_vo2max,
    time_from_vdot,
    percent_vo2max_for_zone,
    pace_for_zone,
    all_paces,
    hm_goal_paces,
    adjust_vdot_for_weight,
)


# ===============================
# CORE EQUATIONS
# ===============================

class TestVo2Cost:
    def test_positive_at_running_speeds(self):
        """VO2 cost should be positive at typical running velocities."""
        # 200 m/min ~ 5:00/km pace
        assert _vo2_cost(200) > 0

    def test_increases_with_speed(self):
        """Faster running costs more oxygen."""
        slow = _vo2_cost(150)
        fast = _vo2_cost(250)
        assert fast > slow


class TestVo2DemandFraction:
    def test_approaches_point_eight_at_long_durations(self):
        """At very long durations, fraction should approach ~0.8."""
        frac = _vo2_demand_fraction(300)  # 5 hours
        assert 0.79 < frac < 0.82

    def test_higher_for_shorter_events(self):
        """Shorter events sustain a higher fraction of VO2max."""
        short = _vo2_demand_fraction(10)   # 10 min
        long = _vo2_demand_fraction(120)   # 2 hours
        assert short > long

    def test_near_one_for_race_durations(self):
        """Around 10-12 min (roughly 3K/5K for elites), fraction near 1.0."""
        frac = _vo2_demand_fraction(10)
        assert 0.95 < frac < 1.05


# ===============================
# VDOT FROM RACE
# ===============================

class TestVdotFromRace:
    def test_5k_21_16_gives_vdot_near_47(self):
        """5K in 21:16 (1276s) should give VDOT approximately 46-48."""
        vdot = vdot_from_race(5000, 1276)
        assert 45 <= vdot <= 48

    def test_hm_1_43_54_gives_vdot_40s(self):
        """HM in 1:43:54 (6234s) gives VDOT in the low-to-mid 40s."""
        vdot = vdot_from_race(21097.5, 6234)
        assert 42 <= vdot <= 48

    def test_hm_1_36_26_gives_vdot_47(self):
        """HM 1:36:26 is the Daniels VDOT 47 equivalent — should be ~47."""
        vdot = vdot_from_race(21097.5, 96 * 60 + 26)
        assert abs(vdot - 47) < 0.5

    def test_faster_race_gives_higher_vdot(self):
        """Faster 5K = higher VDOT."""
        slow = vdot_from_race(5000, 1500)  # 25:00
        fast = vdot_from_race(5000, 1200)  # 20:00
        assert fast > slow


# ===============================
# VELOCITY AT VO2MAX
# ===============================

class TestVelocityAtVo2max:
    def test_reasonable_speed(self):
        """VDOT 47 should give a velocity around 240-260 m/min at 100% VO2max."""
        v = velocity_at_vo2max(47)
        assert 240 < v < 260

    def test_higher_vdot_faster(self):
        """Higher VDOT = higher velocity."""
        v_low = velocity_at_vo2max(40)
        v_high = velocity_at_vo2max(60)
        assert v_high > v_low


# ===============================
# TIME FROM VDOT (race prediction)
# ===============================

class TestTimeFromVdot:
    def test_predict_hm_vdot_47(self):
        """VDOT 47 should predict HM in ~1:34 to 1:44 range."""
        t = time_from_vdot(47, 21097.5)
        t_min = t / 60
        assert 94 <= t_min <= 104  # 1:34 to 1:44

    def test_predict_5k_vdot_47(self):
        """VDOT 47 should predict 5K in ~20-22 min range."""
        t = time_from_vdot(47, 5000)
        t_min = t / 60
        assert 20 <= t_min <= 22

    def test_higher_vdot_faster_time(self):
        """Higher VDOT = faster predicted time."""
        slow = time_from_vdot(40, 5000)
        fast = time_from_vdot(55, 5000)
        assert fast < slow

    def test_roundtrip_consistency(self):
        """vdot_from_race(dist, time_from_vdot(vdot, dist)) ~= vdot."""
        for v in [35, 47, 60, 75]:
            t = time_from_vdot(v, 10000)
            computed = vdot_from_race(10000, t)
            assert abs(computed - v) < 0.01


# ===============================
# TRAINING ZONES
# ===============================

class TestPercentVo2maxForZone:
    def test_all_zones_exist(self):
        """All five Daniels zones should be accessible."""
        for zone in ("easy", "marathon", "threshold", "interval", "repetition"):
            low, high = percent_vo2max_for_zone(zone)
            assert 0 < low <= high

    def test_zones_increase(self):
        """Harder zones should require higher %VO2max."""
        e_low, _ = percent_vo2max_for_zone("easy")
        _, t_high = percent_vo2max_for_zone("threshold")
        i_low, _ = percent_vo2max_for_zone("interval")
        assert e_low < t_high < i_low

    def test_invalid_zone_raises(self):
        with pytest.raises(ValueError, match="Unknown zone"):
            percent_vo2max_for_zone("sprint")


# ===============================
# PACE FOR ZONE
# ===============================

class TestPaceForZone:
    def test_easy_pace_vdot_47(self):
        """Easy pace at VDOT 47 should be ~322-345 sec/km."""
        fast, slow = pace_for_zone(47, "easy")
        assert 315 <= fast <= 330
        assert 338 <= slow <= 352
        # Exact calibrated values
        assert fast == 322
        assert slow == 345

    def test_threshold_pace_vdot_47(self):
        """Threshold at VDOT 47 should be ~269 sec/km."""
        t_pace = pace_for_zone(47, "threshold")
        assert 263 <= t_pace <= 275
        assert t_pace == 269

    def test_interval_pace_vdot_47(self):
        """Interval at VDOT 47 should be ~249 sec/km."""
        i_pace = pace_for_zone(47, "interval")
        assert 243 <= i_pace <= 255
        assert i_pace == 249

    def test_marathon_pace_vdot_47(self):
        """Marathon pace at VDOT 47 should be ~286 sec/km."""
        m_pace = pace_for_zone(47, "marathon")
        assert m_pace == 286

    def test_repetition_pace_vdot_47(self):
        """Repetition at VDOT 47 should be ~227-233 sec/km."""
        fast, slow = pace_for_zone(47, "repetition")
        assert fast == 227
        assert slow == 233

    def test_higher_vdot_faster_paces(self):
        """Higher VDOT should produce faster (lower) paces."""
        t_low = pace_for_zone(40, "threshold")
        t_high = pace_for_zone(55, "threshold")
        assert t_high < t_low  # faster = lower sec/km

    def test_works_for_vdot_30_to_80(self):
        """Should not error for VDOT 30 through 80."""
        for v in range(30, 81):
            paces = pace_for_zone(v, "threshold")
            assert paces > 0
            e = pace_for_zone(v, "easy")
            assert e[0] > 0 and e[1] > 0


# ===============================
# ALL PACES
# ===============================

class TestAllPaces:
    def test_returns_all_zone_keys(self):
        p = all_paces(47)
        assert set(p.keys()) == {"E", "M", "T", "I", "R"}

    def test_tuple_format(self):
        """All values should be tuples of length 2."""
        p = all_paces(47)
        for key, val in p.items():
            assert isinstance(val, tuple), f"{key} should be a tuple"
            assert len(val) == 2, f"{key} should have 2 elements"

    def test_vdot_47_matches_published_table(self):
        """All paces should match the published Daniels VDOT 47 table."""
        p = all_paces(47)
        assert p["E"] == (322, 345)
        assert p["M"] == (286, 286)
        assert p["T"] == (269, 269)
        assert p["I"] == (249, 249)
        assert p["R"] == (227, 233)

    def test_single_pace_zones_have_equal_min_max(self):
        """M, T, I should have min == max."""
        p = all_paces(47)
        for key in ("M", "T", "I"):
            assert p[key][0] == p[key][1], f"{key} min != max"


# ===============================
# HM GOAL PACES
# ===============================

class TestHmGoalPaces:
    def test_goal_structure(self):
        g = hm_goal_paces(47)
        assert set(g.keys()) == {"A", "B", "C"}
        assert all(isinstance(v, int) for v in g.values())

    def test_a_is_threshold(self):
        """A goal = threshold pace."""
        g = hm_goal_paces(47)
        t_pace = pace_for_zone(47, "threshold")
        assert g["A"] == t_pace

    def test_c_slower_than_b(self):
        """C goal should be slower (higher sec/km) than B."""
        g = hm_goal_paces(47)
        assert g["C"] > g["B"]

    def test_a_fastest(self):
        """A goal should be the fastest (lowest sec/km)."""
        g = hm_goal_paces(47)
        assert g["A"] <= g["B"] <= g["C"]

    def test_b_implies_reasonable_hm_time(self):
        """B-goal pace for VDOT 47 should imply HM in 1:34-1:44 range."""
        g = hm_goal_paces(47)
        hm_time = g["B"] * 21.0975  # sec
        hm_min = hm_time / 60
        assert 94 <= hm_min <= 104  # 1:34 to 1:44

    def test_c_is_b_times_1_03(self):
        """C goal = B * 1.03."""
        g = hm_goal_paces(47)
        assert g["C"] == round(g["B"] * 1.03)


# ===============================
# WEIGHT ADJUSTMENT
# ===============================

class TestAdjustVdotForWeight:
    def test_lighter_increases_vdot(self):
        """Losing weight should increase VDOT."""
        adjusted = adjust_vdot_for_weight(47, 70, 65)
        assert adjusted > 47

    def test_heavier_decreases_vdot(self):
        """Gaining weight should decrease VDOT."""
        adjusted = adjust_vdot_for_weight(47, 70, 75)
        assert adjusted < 47

    def test_same_weight_unchanged(self):
        """Same weight should leave VDOT unchanged."""
        adjusted = adjust_vdot_for_weight(47, 70, 70)
        assert adjusted == 47.0

    def test_proportional(self):
        """10% lighter -> ~10% higher VDOT (linear approximation)."""
        adjusted = adjust_vdot_for_weight(47, 70, 63)  # 10% lighter
        assert abs(adjusted - 47 * 70 / 63) < 0.01
