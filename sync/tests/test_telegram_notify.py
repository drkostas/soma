"""Tests for activity-type-aware Telegram notifications (issue #167/#169).

Regression guard: notifications used to hardcode a 🏃 "run" caption for every
Garmin activity, so kite/bike/walk sessions were all announced as "Run".
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from telegram_notify import activity_emoji  # noqa: E402


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
