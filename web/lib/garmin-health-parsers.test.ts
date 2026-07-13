import { describe, it, expect } from "vitest";
import {
  parseDailyHealth, parseWeightEntries, parseSleep, parseHrv, parseTrainingReadiness,
} from "./garmin-health-parsers";
import golden from "./garmin-health-parsers.golden.json";

const g = golden as any;

// Fixtures identical to the ones fed to the Python parsers when the golden was captured.
const userSummary = {
  totalSteps: 8432, totalDistanceMeters: 6100, floorsClimbed: 12, activeTimeInSeconds: 5400,
  sedentaryTimeInSeconds: 40000, moderateIntensityMinutes: 30, vigorousIntensityMinutes: 15,
  totalKilocalories: 2600, activeKilocalories: 800, bmrKilocalories: 1800, restingHeartRate: 52,
  minHeartRate: 45, maxHeartRate: 165, averageStressLevel: 33, maxStressLevel: 88,
  bodyBatteryChargedValue: 70, bodyBatteryDrainedValue: 55, sleepingTimeInSeconds: 27000,
  bodyBatteryAtWakeTime: 82, lastSevenDaysAvgRestingHeartRate: 53, dailyStepGoal: 9000,
};
const sleepData = { dailySleepDTO: {
  sleepTimeSeconds: 27000, deepSleepSeconds: 6000, lightSleepSeconds: 15000, remSleepSeconds: 5000,
  awakeSleepSeconds: 1000, sleepScores: { overall: { value: 78 } },
  sleepStartTimestampLocal: 1710000000000, sleepEndTimestampLocal: 1710027000000, avgSleepStress: 18.5,
} };
const hrvData = { hrvSummary: { weeklyAvg: 62, lastNightAvg: 58, status: "BALANCED", baseline: { balancedLow: 45 } } };
const tr = [
  { validSleep: false, score: 40, level: "LOW" },
  { validSleep: true, score: 72, level: "READY" },
  { validSleep: true, score: 75, level: "READY" },
];
const weighIns = { dateWeightList: [
  { calendarDate: "2026-07-10", weight: 78500, bmi: 24.1, bodyFat: 15.2, bodyWater: 58.0, boneMass: 3400, muscleMass: 36000, sourceType: "MANUAL" },
  { calendarDate: "2026-07-11", weight: 78200, bmi: 24.0, bodyFat: 15.0, bodyWater: 58.2, boneMass: 3400, muscleMass: 36100, sourceType: "INDEX_SCALE" },
] };

describe("garmin-health-parsers — Python parity", () => {
  it("parseDailyHealth matches golden", () => {
    expect(parseDailyHealth("2026-07-13", userSummary)).toEqual(g.daily_health);
  });

  it("parseSleep matches golden (timestamps compared as instants)", () => {
    const s = parseSleep(sleepData)!;
    const { sleep_start, sleep_end, ...rest } = s;
    const { sleep_start: gs, sleep_end: ge, ...grest } = g.sleep;
    expect(rest).toEqual(grest);
    expect(sleep_start!.getTime()).toBe(Date.parse(gs));
    expect(sleep_end!.getTime()).toBe(Date.parse(ge));
  });

  it("parseSleep returns null when no dailySleepDTO", () => {
    expect(parseSleep({})).toBe(g.sleep_none); // both null
  });

  it("parseHrv matches golden", () => {
    expect(parseHrv(hrvData)).toEqual(g.hrv);
  });

  it("parseTrainingReadiness prefers latest validSleep entry", () => {
    expect(parseTrainingReadiness(tr)).toEqual(g.training_readiness);
    expect(parseTrainingReadiness([])).toEqual(g.training_readiness_empty);
  });

  it("parseWeightEntries matches golden", () => {
    expect(parseWeightEntries(weighIns)).toEqual(g.weights);
  });
});
