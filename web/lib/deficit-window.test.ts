import { describe, it, expect } from "vitest";
import { deficitWindow, windowLabel, countsForDeficit, type WindowDay } from "./deficit-window";

const d = (date: string, deficit: number, closed = true, coverage: number | null = 1): WindowDay => ({ date, closed, coverage, deficit });

describe("deficitWindow (#728)", () => {
  it("a day counts only when closed and over the coverage floor", () => {
    expect(countsForDeficit(d("2026-03-01", -800))).toBe(true);
    expect(countsForDeficit(d("2026-03-01", -800, false, 1))).toBe(false);
    expect(countsForDeficit(d("2026-03-01", -800, true, 0.5))).toBe(false);
    expect(countsForDeficit(d("2026-03-01", -800, true, null))).toBe(false);
    expect(countsForDeficit(d("2026-03-01", -800, true, 0.75))).toBe(true);
  });

  it("no counted day ever → empty, inactive, labelled yet", () => {
    const w = deficitWindow([d("2026-09-01", -2248, false, 0.25)], "2026-09-06");
    expect(w).toMatchObject({ start: null, end: null, countedDays: 0, totalDeficit: 0, avgDeficit: null, active: false });
    expect(windowLabel(w)).toBe("no counted day yet");
  });

  it("THE case: a March–May diet, then four empty months → the window is that spring, inactive", () => {
    const spring = ["2026-03-14", "2026-03-15", "2026-03-16", "2026-03-20", "2026-03-27", "2026-04-02"].map((x) => d(x, -900));
    const summerClosedEmpty = ["2026-05-20", "2026-06-10"].map((x) => d(x, -2300, true, 0)); // closed, nothing logged: absent
    const w = deficitWindow([...spring, ...summerClosedEmpty, d("2026-09-01", -2248, false, 0.25)], "2026-09-06");
    expect(w.start).toBe("2026-03-14");
    expect(w.end).toBe("2026-04-02");
    expect(w.countedDays).toBe(6);
    expect(w.totalDeficit).toBe(5400);
    expect(w.avgDeficit).toBe(900);
    expect(w.active).toBe(false);
    expect(windowLabel(w)).toBe("no counted day since 2026-04-02");
    expect(w.countedDates.has("2026-05-20")).toBe(false);
  });

  it("a gap wider than 7 days splits windows; only the latest is summed", () => {
    const first = ["2026-03-01", "2026-03-02", "2026-03-03"].map((x) => d(x, -1000));
    const second = ["2026-03-15", "2026-03-16"].map((x) => d(x, -500));
    const w = deficitWindow([...first, ...second], "2026-03-17");
    expect(w.start).toBe("2026-03-15");
    expect(w.countedDays).toBe(2);
    expect(w.totalDeficit).toBe(1000);
    expect(w.avgDeficit).toBe(500);
    expect(w.active).toBe(true);
    expect(w.allCountedDates.size).toBe(5);
    expect(windowLabel(w)).toBe("since 2026-03-15, 2 counted days");
  });

  it("a gap of exactly 7 days does not split; 8 does", () => {
    const a = deficitWindow([d("2026-03-01", -800), d("2026-03-08", -800)], "2026-03-09");
    expect(a.countedDays).toBe(2);
    const b = deficitWindow([d("2026-03-01", -800), d("2026-03-09", -800)], "2026-03-10");
    expect(b.countedDays).toBe(1);
    expect(b.start).toBe("2026-03-09");
  });

  it("active flips off when the last counted day is more than 7 days before today", () => {
    const days = [d("2026-08-20", -800), d("2026-08-21", -800)];
    expect(deficitWindow(days, "2026-08-28").active).toBe(true);
    expect(deficitWindow(days, "2026-08-29").active).toBe(false);
  });

  it("a surplus day inside the window lowers the total, never breaks it", () => {
    const w = deficitWindow([d("2026-03-01", -800), d("2026-03-02", 400), d("2026-03-03", -800)], "2026-03-04");
    expect(w.countedDays).toBe(3);
    expect(w.totalDeficit).toBe(1200);
    expect(w.avgDeficit).toBe(400);
  });

  it("order of input does not matter", () => {
    const w = deficitWindow([d("2026-03-03", -800), d("2026-03-01", -800), d("2026-03-02", -800)], "2026-03-04");
    expect(w.start).toBe("2026-03-01");
    expect(w.end).toBe("2026-03-03");
  });
});
