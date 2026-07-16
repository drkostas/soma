import { describe, it, expect } from "vitest";
import { computeWeeklyAdherence } from "./adherence";

describe("computeWeeklyAdherence", () => {
  it("is on_track within ±10% of goal", () => {
    expect(computeWeeklyAdherence(5600, 5600)?.status).toBe("on_track"); // exact
    expect(computeWeeklyAdherence(5100, 5600)?.status).toBe("on_track"); // ~0.91
    expect(computeWeeklyAdherence(6100, 5600)?.status).toBe("on_track"); // ~1.09
  });

  it("is under below 90% of goal", () => {
    expect(computeWeeklyAdherence(4000, 5600)?.status).toBe("under"); // ~0.71
  });

  it("is over above 110% of goal", () => {
    expect(computeWeeklyAdherence(7000, 5600)?.status).toBe("over"); // 1.25
  });

  it("returns null when there is no goal", () => {
    expect(computeWeeklyAdherence(500, 0)).toBeNull();
  });

  it("rounds the reported kcal figures", () => {
    const a = computeWeeklyAdherence(5601.7, 5600.4);
    expect(a?.weeklyActual).toBe(5602);
    expect(a?.weeklyGoal).toBe(5600);
  });
});
