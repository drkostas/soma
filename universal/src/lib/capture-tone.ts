/**
 * The headline colour for a capture, as an explicit value rather than a class.
 *
 * ⛔ A COLOUR CLASS DOES NOT WORK HERE, silently. soma-style's `Text` puts its variant's own
 * `text-text` ahead of the caller's `className`, and NativeWind resolves two utilities for the
 * same property by the order of the generated stylesheet, not the order of the class string. So
 * `className="text-danger"` rendered as plain `#fdf8f2`, which I measured out of a screenshot's
 * pixels rather than guessed. The same mistake had already left the capture box's own error
 * message the same colour as ordinary text. An inline style always wins in React Native.
 *
 * It lives in a lib rather than beside the component because vitest cannot parse `react-native`
 * (Flow), so anything importing a component is untestable here.
 *
 * The values mirror soma-style's preset: `danger`, `text.secondary`, `text.DEFAULT`.
 */
import type { CaptureStatus } from "./meal-capture";

export const TONE = { danger: "#e06060", quiet: "#a0b4c0", normal: "#fdf8f2" } as const;

export function toneColor(c: { status: CaptureStatus }): string {
  if (c.status === "failed") return TONE.danger;
  // A logged capture needs nothing from the owner, so it recedes rather than competing.
  if (c.status === "logged") return TONE.quiet;
  return TONE.normal;
}
