/**
 * Activity-type-aware notification helpers — TS port of the pure logic in
 * sync/src/telegram_notify.py (activity_emoji + activity_label). Stage 4 (#186).
 * Substring match on the Garmin typeKey; first match wins, so specific keys are
 * ordered before generic ones ("trail" before "run").
 */

const ACTIVITY_EMOJI: Array<[string, string]> = [
  ["kite", "🪁"], ["wind_surf", "🏄"], ["surf", "🏄"], ["run", "🏃"], ["trail", "🏃"],
  ["cycl", "🚴"], ["bik", "🚴"], ["bmx", "🚴"], ["walk", "🚶"], ["hik", "🥾"],
  ["swim", "🏊"], ["ski", "⛷️"], ["snowboard", "🏂"], ["row", "🚣"], ["strength", "🏋️"], ["yoga", "🧘"],
];

const ACTIVITY_LABEL: Array<[string, string]> = [
  ["kite", "Kiteboarding"], ["wind_surf", "Windsurf"], ["surf", "Surf"], ["trail", "Trail Run"],
  ["run", "Run"], ["cycl", "Ride"], ["bik", "Ride"], ["bmx", "Ride"], ["walk", "Walk"], ["hik", "Hike"],
  ["swim", "Swim"], ["ski", "Ski"], ["snowboard", "Snowboard"], ["row", "Row"], ["strength", "Strength"], ["yoga", "Yoga"],
];

/** Emoji for a Garmin activity typeKey. Falls back to a generic medal. */
export function activityEmoji(activityType: string | null | undefined): string {
  const key = (activityType || "").toLowerCase();
  for (const [needle, emoji] of ACTIVITY_EMOJI) if (key.includes(needle)) return emoji;
  return "🏅";
}

/** Human label for a Garmin activity typeKey (e.g. "Kiteboarding"). Falls back to "Activity". */
export function activityLabel(activityType: string | null | undefined): string {
  const key = (activityType || "").toLowerCase();
  for (const [needle, label] of ACTIVITY_LABEL) if (key.includes(needle)) return label;
  return "Activity";
}
