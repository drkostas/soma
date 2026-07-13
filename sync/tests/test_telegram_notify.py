"""Tests for activity-type-aware Telegram notifications (issue #167/#169).

Regression guard: notifications used to hardcode a 🏃 "run" caption for every
Garmin activity, so kite/bike/walk sessions were all announced as "Run".
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from telegram_notify import activity_emoji, activity_label  # noqa: E402


class TestActivityEmoji:
    def test_kite_variants_resolve_to_kite(self) -> None:
        # The live Garmin typeKey is "kiteboarding_v2"; substring match must catch it.
        assert activity_emoji("kiteboarding_v2") == "🪁"
        assert activity_emoji("kitesurfing") == "🪁"

    def test_common_types(self) -> None:
        assert activity_emoji("running") == "🏃"
        assert activity_emoji("treadmill_running") == "🏃"
        assert activity_emoji("cycling") == "🚴"
        assert activity_emoji("mountain_biking") == "🚴"
        assert activity_emoji("walking") == "🚶"
        assert activity_emoji("hiking") == "🥾"
        assert activity_emoji("lap_swimming") == "🏊"
        assert activity_emoji("strength_training") == "🏋️"

    def test_kite_is_not_labelled_as_run(self) -> None:
        # The original bug: kite sessions came through as the run emoji.
        assert activity_emoji("kiteboarding_v2") != "🏃"

    def test_unknown_falls_back_to_medal(self) -> None:
        assert activity_emoji("some_new_sport") == "🏅"
        assert activity_emoji("") == "🏅"
        assert activity_emoji(None) == "🏅"


class TestActivityLabel:
    """Guards the push-notification title ('Run Synced' was hardcoded for all types)."""

    def test_kite_label(self) -> None:
        assert activity_label("kiteboarding_v2") == "Kiteboarding"
        assert activity_label("kiteboarding_v2") != "Run"

    def test_common_labels(self) -> None:
        assert activity_label("running") == "Run"
        assert activity_label("treadmill_running") == "Run"
        assert activity_label("cycling") == "Ride"
        assert activity_label("walking") == "Walk"
        assert activity_label("hiking") == "Hike"
        assert activity_label("lap_swimming") == "Swim"

    def test_unknown_falls_back_to_activity(self) -> None:
        assert activity_label("some_new_sport") == "Activity"
        assert activity_label(None) == "Activity"
