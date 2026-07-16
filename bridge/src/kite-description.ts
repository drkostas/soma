/**
 * Kiteboarding Strava title + description — TS port of the pure helpers in
 * sync/src/garmin_push.py (kite_activity_name + generate_kite_strava_description).
 * Used by the refinalize entrypoint to rebuild a bridged kite session's Strava
 * text from its extracted per-jump data. Heights in metres, speed in knots.
 */
type Obj = Record<string, any>;

const MS_TO_KNOTS = 1.94384;
/** Python round() (ties to even). */
function r(x: number, n: number): number {
  const m = 10 ** n, y = x * m, f = Math.floor(y), d = y - f;
  const i = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
  return i / m;
}

/** e.g. "Schinias · Max Jump: 5.2m · 29 jumps". */
export function kiteActivityName(summary: Obj, payload: Obj): string {
  const s = payload.summary || {};
  const spot = s.spot || summary.activityName || "Kiteboarding";
  const n = s.jump_count || 0, mh = s.max_height_m;
  if (mh && n) return `${spot} · Max Jump: ${mh}m · ${n} jumps`;
  return s.spot ? `${spot} Kiteboarding` : (summary.activityName || "Kiteboarding");
}

/** Rich Strava description for a kite session, built from the per-jump data. */
export function generateKiteStravaDescription(summary: Obj, payload: Obj): string {
  const s = payload.summary || {};
  const jumps: Obj[] = payload.jumps || [];
  const lines: string[] = [];
  const SEP = "  ·  ";

  const headline: string[] = [];
  if (s.max_height_m) headline.push(`🪁 Max Jump: ${s.max_height_m} m`);
  if (s.max_airtime_s) headline.push(`⏱️ Airtime: ${r(Number(s.max_airtime_s), 1)} s`);
  if (s.jump_count) headline.push(`🔢 ${s.jump_count} jumps`);
  if (headline.length) lines.push(headline.join(SEP));

  const stats: string[] = [];
  const dist = summary.distance || 0;
  if (dist > 0) stats.push(`📏 ${(dist / 1000).toFixed(1)} km`);
  const maxSpeed = summary.maxSpeed || 0;
  if (maxSpeed && maxSpeed > 0) stats.push(`💨 ${(maxSpeed * MS_TO_KNOTS).toFixed(1)} kn`);
  const dur = summary.movingDuration || summary.duration || 0;
  if (dur > 0) stats.push(`🕒 ${Math.trunc(dur / 3600)}h ${String(Math.trunc((dur % 3600) / 60)).padStart(2, "0")}m`);
  const avgHr = summary.averageHR || 0;
  if (avgHr && avgHr > 0) stats.push(`❤️ ${r(avgHr, 0)} bpm`);
  if (stats.length) lines.push(stats.join(SEP));

  const top = jumps.filter((j) => j.rank).slice(0, 5);
  if (top.length) {
    lines.push("");
    lines.push("Top jumps:");
    for (const j of top) {
      let seg = `  ${j.rank}. ${j.height_m} m`;
      if (j.airtime_s) seg += `, ${r(Number(j.airtime_s), 1)} s air`;
      if (j.distance_m) seg += `, ${j.distance_m} m`;
      lines.push(seg);
    }
  }

  if (lines.length) {
    lines.push("");
    lines.push("Tracked by github.com/drkostas/soma");
  }
  return lines.join("\n");
}
