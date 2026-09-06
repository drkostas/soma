import { describe, it, expect } from "vitest";
import { trendAte, type TrendAteInput } from "./trend-ate";

const row = (o: Partial<TrendAteInput>): TrendAteInput => ({
  isToday: false,
  closed: false,
  actualCalories: 0,
  loggedCalories: 0,
  todayConsumed: 0,
  ...o,
});

describe("trendAte (#717)", () => {
  const cases: [string, TrendAteInput, number][] = [
    ["today uses the live consumed total, not the (unset) actual", row({ isToday: true, todayConsumed: 812, actualCalories: 0, loggedCalories: 812 }), 812],
    ["today with nothing eaten is 0", row({ isToday: true, todayConsumed: 0, loggedCalories: 0 }), 0],
    ["closed day keeps actual_calories (close-day reconciled)", row({ closed: true, actualCalories: 1540, loggedCalories: 1480 }), 1540],
    ["closed day with actual 0 stays 0 even if meal_log has rows (close wins)", row({ closed: true, actualCalories: 0, loggedCalories: 465 }), 0],
    ["THE case: open past day, one meal logged, actual still 0 → the logged sum", row({ closed: false, actualCalories: 0, loggedCalories: 465 }), 465],
    ["open past day with nothing logged is 0, not a fabricated number", row({ closed: false, actualCalories: 0, loggedCalories: 0 }), 0],
    ["open past day: null logged sum reads as 0", row({ closed: false, loggedCalories: null }), 0],
    ["closed day: null actual reads as 0", row({ closed: true, actualCalories: null, loggedCalories: 900 }), 0],
    ["numeric strings from pg are coerced", row({ closed: false, loggedCalories: "465" as unknown as number }), 465],
    ["a closed today is still today (the hero total is the freshest)", row({ isToday: true, closed: true, todayConsumed: 1200, actualCalories: 1150 }), 1200],
  ];
  for (const [name, input, want] of cases) {
    it(name, () => {
      expect(trendAte(input)).toBe(want);
    });
  }
});
