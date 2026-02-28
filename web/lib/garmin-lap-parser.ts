export interface ParsedSegment {
  index: number;
  type:
    | "warmup" | "easy" | "aerobic" | "tempo"
    | "interval" | "vo2max" | "recovery" | "rest"
    | "strides" | "cooldown";
  duration_s: number;
  distance_m: number;
  avg_hr: number | null;
  hr_zone: number | null;
  is_repeat: boolean;
  repeat_iteration: number;
  wkt_step_index: number | null;
}

const INTENSITY_MAP: Record<string, ParsedSegment["type"]> = {
  WARMUP: "warmup",
  INTERVAL: "interval",
  ACTIVE: "interval", // firmware rename
  RECOVERY: "recovery",
  REST: "rest",
  COOLDOWN: "cooldown",
  EASY: "easy",
};

export function parseStructuredLaps(laps: unknown[]): ParsedSegment[] {
  const rawLaps = laps as Array<Record<string, unknown>>;
  const workoutLaps = rawLaps.filter((l) => l.wktStepIndex != null);

  // Group consecutive laps with same (wktStepIndex, intensityType)
  const groups: Array<{
    wktStepIndex: number;
    intensityType: string;
    laps: Array<Record<string, unknown>>;
  }> = [];

  for (const lap of workoutLaps) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.wktStepIndex === lap.wktStepIndex &&
      last.intensityType === lap.intensityType
    ) {
      last.laps.push(lap);
    } else {
      groups.push({
        wktStepIndex: lap.wktStepIndex as number,
        intensityType: lap.intensityType as string,
        laps: [lap],
      });
    }
  }

  // Track iterations per step index (transitions back = new iteration)
  const seen = new Map<number, number>();
  return groups.map((g, i) => {
    const prev = seen.get(g.wktStepIndex) ?? 0;
    seen.set(g.wktStepIndex, prev + 1);

    const dur = g.laps.reduce((s, l) => s + ((l.duration as number) ?? 0), 0);
    const dist = g.laps.reduce((s, l) => s + ((l.distance as number) ?? 0), 0);
    const hrSum = g.laps.reduce((s, l) => s + ((l.averageHR as number) ?? 0), 0);
    const avgHr = g.laps.length > 0 ? hrSum / g.laps.length : null;

    return {
      index: i,
      type: INTENSITY_MAP[g.intensityType?.toUpperCase() ?? ""] ?? "easy",
      duration_s: Math.round(dur),
      distance_m: Math.round(dist),
      avg_hr: avgHr ? Math.round(avgHr) : null,
      hr_zone: null,
      is_repeat: prev > 0,
      repeat_iteration: prev,
      wkt_step_index: g.wktStepIndex,
    };
  });
}

export function parseUnstructuredLaps(
  laps: unknown[],
  zoneThresholds: number[] = [0, 114, 133, 152, 171, 999]
): ParsedSegment[] {
  const rawLaps = laps as Array<Record<string, unknown>>;

  function getZone(hr: number): number {
    for (let i = zoneThresholds.length - 2; i >= 0; i--) {
      if (hr >= zoneThresholds[i]) return i + 1;
    }
    return 1;
  }

  const zoneToType = (z: number): ParsedSegment["type"] => {
    const map: ParsedSegment["type"][] = [
      "easy", "easy", "aerobic", "tempo", "interval", "vo2max",
    ];
    return map[Math.min(z, 5)] ?? "easy";
  };

  // 3-lap rolling average HR smoothing
  type SmoothedLap = Record<string, unknown> & { _smoothedHR: number };
  const smoothed: SmoothedLap[] = rawLaps.map((lap, i) => {
    const window = rawLaps.slice(Math.max(0, i - 1), i + 2);
    const avgHr = window.reduce((s, l) => s + ((l.averageHR as number) ?? 0), 0) / window.length;
    return { ...lap, _smoothedHR: avgHr };
  });

  // Group consecutive same-zone laps
  const groups: Array<{ zone: number; laps: SmoothedLap[] }> = [];
  for (const lap of smoothed) {
    const zone = getZone(lap._smoothedHR);
    const last = groups[groups.length - 1];
    if (last && last.zone === zone) {
      last.laps.push(lap);
    } else {
      groups.push({ zone, laps: [lap] });
    }
  }

  return groups.map((g, i) => {
    const dur = g.laps.reduce((s, l) => s + ((l.duration as number) ?? 0), 0);
    const dist = g.laps.reduce((s, l) => s + ((l.distance as number) ?? 0), 0);
    const hrSum = g.laps.reduce((s, l) => s + ((l.averageHR as number) ?? 0), 0);

    return {
      index: i,
      type: zoneToType(g.zone),
      duration_s: Math.round(dur),
      distance_m: Math.round(dist),
      avg_hr: g.laps.length > 0 ? Math.round(hrSum / g.laps.length) : null,
      hr_zone: g.zone,
      is_repeat: false,
      repeat_iteration: 0,
      wkt_step_index: null,
    };
  });
}
