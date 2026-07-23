import { View } from "react-native";
import { Text, Card, Sparkline } from "soma-style";
import type { SleepSummary, SleepNight } from "../lib/api";

const DEEP = "#4f46e5";
const LIGHT = "#a5b4fc";
const REM = "#c084fc";
const AWAKE = "#f87171";

function hm(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Horizontal stacked stage bar (deep/light/rem/awake proportions of one night). */
function StageBar({ n, height = 14 }: { n: SleepNight; height?: number }) {
  const total = (n.deep ?? 0) + (n.light ?? 0) + (n.rem ?? 0) + (n.awake ?? 0);
  if (total <= 0) return null;
  const seg = (v: number | null, c: string) =>
    v ? <View key={c} style={{ width: `${(v / total) * 100}%`, backgroundColor: c }} /> : null;
  return (
    <View className="flex-row overflow-hidden rounded-md" style={{ height }}>
      {seg(n.deep, DEEP)}
      {seg(n.light, LIGHT)}
      {seg(n.rem, REM)}
      {seg(n.awake, AWAKE)}
    </View>
  );
}

/** Per-night stacked stage columns (last N nights), heights scaled to max total. */
function StagesTrend({ nights }: { nights: SleepNight[] }) {
  const data = nights.filter((n) => (n.total ?? 0) > 0).slice(-30);
  if (data.length < 2) return null;
  const maxTotal = Math.max(...data.map((n) => n.total ?? 0)) || 1;
  return (
    <View className="h-28 flex-row items-end gap-0.5">
      {data.map((n, i) => {
        const total = n.total ?? 0;
        const colH = (total / maxTotal) * 100;
        const seg = (v: number | null, c: string) =>
          v ? <View key={c} style={{ height: `${(v / total) * 100}%`, backgroundColor: c }} /> : null;
        return (
          <View key={i} className="flex-1 justify-end self-stretch">
            <View className="w-full overflow-hidden rounded-t-sm" style={{ height: `${Math.max(3, colH)}%` }}>
              {/* stacked top→bottom: awake, rem, light, deep (deep at the base) */}
              {seg(n.awake, AWAKE)}
              {seg(n.rem, REM)}
              {seg(n.light, LIGHT)}
              {seg(n.deep, DEEP)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Legend() {
  const items: [string, string][] = [["Deep", DEEP], ["Light", LIGHT], ["REM", REM], ["Awake", AWAKE]];
  return (
    <View className="flex-row flex-wrap gap-3">
      {items.map(([label, c]) => (
        <View key={label} className="flex-row items-center gap-1">
          <View className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
          <Text variant="micro" className="text-text-muted">{label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Sleep dashboard: last-night detail + stages trend + score trend. Fed by /api/sleep/summary. */
export function SleepDashboard({ summary }: { summary: SleepSummary | null | undefined }) {
  if (!summary) return null;
  const ln = summary.lastNight;
  const scores = summary.trend.map((n) => n.score).filter((v): v is number => v != null);

  return (
    <View className="gap-4">
      {ln ? (
        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Last night</Text>
            <Text variant="micro" className="text-text-muted">{shortDate(ln.date)}</Text>
          </View>
          <View className="flex-row items-end gap-2">
            <Text variant="display" className="text-indigo">{hm(ln.total)}</Text>
            {ln.score != null ? <Text variant="caption" className="text-text-muted mb-1">score {ln.score}</Text> : null}
          </View>
          <StageBar n={ln} />
          <View className="flex-row flex-wrap gap-x-5 gap-y-1">
            <Text variant="micro" className="text-text-secondary">Deep {hm(ln.deep)}</Text>
            <Text variant="micro" className="text-text-secondary">REM {hm(ln.rem)}</Text>
            <Text variant="micro" className="text-text-secondary">Light {hm(ln.light)}</Text>
            {ln.hr != null ? <Text variant="micro" className="text-text-secondary">HR {Math.round(ln.hr)} bpm</Text> : null}
            {ln.spo2 != null ? <Text variant="micro" className="text-text-secondary">SpO₂ {Math.round(ln.spo2)}%</Text> : null}
          </View>
        </Card>
      ) : null}

      <Card className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text variant="eyebrow">Sleep stages</Text>
          <Text variant="micro" className="text-text-muted">last {Math.min(30, summary.trend.length)} nights</Text>
        </View>
        <StagesTrend nights={summary.trend} />
        <Legend />
      </Card>

      {scores.length >= 2 ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Sleep score</Text>
            <Text variant="micro" className="tabular-nums text-text-muted">
              avg {summary.stats.avg_score != null ? Math.round(summary.stats.avg_score) : "—"}
            </Text>
          </View>
          <Sparkline data={scores} color="#a5b4fc" height={40} baseline />
        </Card>
      ) : null}
    </View>
  );
}
