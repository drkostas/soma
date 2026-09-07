/** Web's cumulative-deficit goal pace as pure data (soma#782): a straight line from the
 *  window's first counted day, sampled daily, to its last day (+14 days while the window is
 *  still active) (#728). Lives outside the component so vitest can cover it without RN. */
const dayMs = 86400000;
function toDate(iso: string): number { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, (m ?? 1) - 1, d ?? 1); }
function isoOf(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

export interface PaceWindow { active: boolean; start?: string | null; end?: string | null; countedDays?: number; label?: string }

export function goalPaceSeries(
  axisDates: string[],
  profile: { window?: PaceWindow | null },
  goalDeficit: number,
  firstCounted: string | null,
): { axis: string[]; pace: (number | null)[] } {
  const winStart = profile.window?.start ?? firstCounted;
  const lastData = axisDates.length ? axisDates[axisDates.length - 1] : null;
  const winEnd = profile.window?.end ?? lastData;
  if (!winStart || !winEnd) return { axis: axisDates, pace: axisDates.map(() => null) };
  const startMs = toDate(winStart);
  const endMs = toDate(winEnd) + (profile.window && !profile.window.active ? 0 : 14) * dayMs;
  const set = new Set(axisDates);
  for (let ms = startMs; ms <= endMs; ms += dayMs) set.add(isoOf(ms));
  const axis = [...set].sort();
  const pace = axis.map((d) => {
    const t = toDate(d);
    if (t < startMs || t > endMs) return null;
    return Math.round(-goalDeficit * ((t - startMs) / dayMs)) || 0;
  });
  return { axis, pace };
}

