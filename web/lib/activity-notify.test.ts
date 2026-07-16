import { describe, it, expect } from "vitest";
import { activityEmoji, activityLabel } from "./activity-notify";
import golden from "./activity-notify.golden.json";

describe("activity-notify — Python parity (activity_emoji + activity_label)", () => {
  it("matches Python for every typeKey (24 cases, incl. substring precedence + null)", () => {
    for (const c of golden as Array<{ t: string | null; emoji: string; label: string }>) {
      expect(activityEmoji(c.t)).toBe(c.emoji);
      expect(activityLabel(c.t)).toBe(c.label);
    }
  });

  it("substring precedence: trail before run for the label", () => {
    expect(activityLabel("trail_running")).toBe("Trail Run");
    expect(activityLabel("running")).toBe("Run");
  });

  it("fallbacks for unknown / empty", () => {
    expect(activityEmoji("obstacle_course")).toBe("🏅");
    expect(activityLabel(null)).toBe("Activity");
  });
});
