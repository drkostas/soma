/** Web's trajectory-chart annotations as pure data (soma#776): goal-zone bands and tier
 *  lines (A = goal, B = goal − 2, C = goal − 3.5 VDOT), the Today and Race lines and the
 *  12-day taper band, all expressed against the trajectory's date index so the shared
 *  chart can draw them. Pure so it can be unit-tested while no plan is live. */
export interface TrajectoryPointLike { date: string }
export interface TrajectoryAnnotations {
  refAreas: { y1: number; y2: number; color: string; opacity?: number }[];
  refLines: { y: number; color?: string; dashed?: boolean; label?: string }[];
  xLines: { i: number; color?: string; dashed?: boolean }[];
  xBands: { i0: number; i1: number; color: string; opacity?: number }[];
  hasToday: boolean; hasRace: boolean; hasTaper: boolean;
}
export const TAPER_DAYS = 12;

export function trajectoryAnnotations(
  points: TrajectoryPointLike[],
  opts: { goalVdot: number | null; raceDate: string | null; today: string; hmTime: (vdot: number) => string },
): TrajectoryAnnotations {
  const dates = points.map((p) => p.date.slice(0, 10));
  const idxOf = (d: string | null | undefined) => (d ? dates.findIndex((x) => x >= d) : -1);
  const todayIdx = idxOf(opts.today);
  const race = opts.raceDate ? opts.raceDate.slice(0, 10) : null;
  const raceIdx = idxOf(race);
  const taperStart = race ? new Date(new Date(race).getTime() - TAPER_DAYS * 86400000).toISOString().slice(0, 10) : null;
  const taperIdx = idxOf(taperStart);
  const g = opts.goalVdot;
  const tiers = g != null && isFinite(g)
    ? [
        { y: g, color: "#6ad4a0", label: `A (${opts.hmTime(g)})` },
        { y: g - 2, color: "#8b9df0", label: `B (${opts.hmTime(g - 2)})` },
        { y: g - 3.5, color: "#e0c458", label: `C (${opts.hmTime(g - 3.5)})` },
      ]
    : [];
  const hasTaper = taperIdx >= 0 && raceIdx > taperIdx;
  return {
    refAreas: g != null && isFinite(g) ? [{ y1: g - 2, y2: g, color: "#6ad4a0", opacity: 0.08 }, { y1: g - 3.5, y2: g - 2, color: "#e0c458", opacity: 0.07 }] : [],
    refLines: tiers,
    xLines: [...(todayIdx >= 0 ? [{ i: todayIdx, color: "#e0c458" }] : []), ...(raceIdx >= 0 ? [{ i: raceIdx, color: "#c084fc", dashed: true }] : [])],
    xBands: hasTaper ? [{ i0: taperIdx, i1: raceIdx, color: "#8b9df0", opacity: 0.12 }] : [],
    hasToday: todayIdx >= 0, hasRace: raceIdx >= 0, hasTaper,
  };
}
