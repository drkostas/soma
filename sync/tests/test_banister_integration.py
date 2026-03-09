# sync/tests/test_banister_integration.py
"""Tests that runner calls Banister fitting and PMC uses personal tau."""
from training_engine.load_stream import compute_pmc
from datetime import date, timedelta


def test_compute_pmc_with_custom_tau():
    """PMC should use personal tau values when provided."""
    loads = [(date(2026, 1, 1) + timedelta(days=i), 100.0 if i % 3 == 0 else 0.0)
             for i in range(30)]

    default_pmc = compute_pmc(loads, tau_ctl=42, tau_atl=7)
    custom_pmc = compute_pmc(loads, tau_ctl=38, tau_atl=9)

    # Different tau values should produce different CTL/ATL
    assert default_pmc[-1]["ctl"] != custom_pmc[-1]["ctl"]
    assert default_pmc[-1]["atl"] != custom_pmc[-1]["atl"]


def test_compute_pmc_tau_affects_decay():
    """Shorter tau1 should mean faster fitness decay."""
    # Single load then 60 rest days — enough for faster decay to dominate
    loads = [(date(2026, 1, 1), 100.0)]
    loads += [(date(2026, 1, 1) + timedelta(days=i), 0.0) for i in range(1, 61)]

    slow_decay = compute_pmc(loads, tau_ctl=50, tau_atl=7)
    fast_decay = compute_pmc(loads, tau_ctl=30, tau_atl=7)

    # After 60 days of rest, shorter tau should have lower CTL
    assert fast_decay[-1]["ctl"] < slow_decay[-1]["ctl"]
