import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));

// The mock above must be declared before the modules it replaces are imported.
// eslint-disable-next-line import/first
import AsyncStorage from "@react-native-async-storage/async-storage";
// eslint-disable-next-line import/first
import {
  RANGES, rangeToDays, rangeLabel, isRangeKey, getRangePref, setRangePref, hydrateRangePref,
  isRangeHydrated, __resetRangePrefForTests, DEFAULT_RANGE,
} from "./time-range";

beforeEach(() => { store.clear(); __resetRangePrefForTests(); vi.clearAllMocks(); });

describe("range tokens (mirror web/lib/time-ranges.ts)", () => {
  it("has the ten web keys with the same day counts", () => {
    expect(RANGES.map((r) => [r.value, r.days])).toEqual([
      ["1w", 7], ["2w", 14], ["1m", 30], ["3m", 90], ["6m", 180], ["9m", 270], ["1y", 365], ["2y", 730], ["3y", 1095], ["all", 3650],
    ]);
    expect(rangeToDays("2y")).toBe(730);
    expect(rangeToDays(undefined)).toBe(180);
    expect(rangeLabel("1w")).toBe("1W");
    expect(isRangeKey("90d")).toBe(false);
  });
});

describe("shared persisted range (#754)", () => {
  it("starts at 6M and writes every change to storage", () => {
    expect(getRangePref()).toBe(DEFAULT_RANGE);
    setRangePref("1w");
    expect(getRangePref()).toBe("1w");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("soma_time_range", "1w");
  });
  it("ignores unknown keys and no-op writes", () => {
    setRangePref("90d");
    setRangePref("nope");
    expect(getRangePref()).toBe(DEFAULT_RANGE);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
  it("hydrates the stored choice once at startup", async () => {
    store.set("soma_time_range", "2y");
    expect(isRangeHydrated()).toBe(false);
    await hydrateRangePref();
    await hydrateRangePref();
    expect(getRangePref()).toBe("2y");
    expect(isRangeHydrated()).toBe(true);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  });
  it("keeps the default when storage holds garbage or nothing", async () => {
    store.set("soma_time_range", "forever");
    await hydrateRangePref();
    expect(getRangePref()).toBe(DEFAULT_RANGE);
    expect(isRangeHydrated()).toBe(true);
  });
  it("a choice made before hydration finishes wins over the stored one", async () => {
    store.set("soma_time_range", "1y");
    const p = hydrateRangePref();
    setRangePref("1m");
    await p;
    expect(getRangePref()).toBe("1m");
  });
});
