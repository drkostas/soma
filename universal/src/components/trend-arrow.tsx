import { Text } from "soma-style";

/** A compact 7-day-vs-prior-week trend indicator computed from a metric's recent
 *  series (e.g. a stat card's 14-day sparkline). Renders ↑/↓/→ + the % change,
 *  colored by whether the change is an improvement. `inverted` = lower-is-better
 *  (resting HR, stress), so a decrease reads as green. Matches the web StatCard
 *  trend badge. Renders nothing when there isn't enough data. */
export function TrendArrow({ series, inverted }: { series?: (number | null)[]; inverted?: boolean }) {
  const vals = (series ?? []).filter((v): v is number => typeof v === "number" && isFinite(v));
  if (vals.length < 4) return null;
  const half = Math.floor(vals.length / 2);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const prior = mean(vals.slice(0, half));
  const recent = mean(vals.slice(vals.length - half));
  if (!prior) return null;
  const pct = ((recent - prior) / Math.abs(prior)) * 100;
  const flat = Math.abs(pct) < 1;
  const up = pct > 0;
  const improving = inverted ? !up : up;
  const color = flat ? "#5a7a8a" : improving ? "#6ad4a0" : "#e06060";
  const arrow = flat ? "→" : up ? "↑" : "↓";
  return <Text variant="micro" className="tabular-nums" style={{ color }}>{arrow} {Math.abs(Math.round(pct))}%</Text>;
}
