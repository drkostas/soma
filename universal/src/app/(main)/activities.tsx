import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Text, Card, Badge, ProgressBar, SegmentedControl } from "soma-style";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3456";

type RangeKey = "30d" | "90d" | "1y" | "all";
const RANGES: readonly RangeKey[] = ["30d", "90d", "1y", "all"] as const;
const RANGE_LABEL: Record<RangeKey, string> = { "30d": "30d", "90d": "90d", "1y": "1y", all: "All" };

/** Per-sport rollup (mirrors the web getActivitySummary grouping, labelled). */
interface SportSummary {
  label: string;
  count: number;
  total_km: number;
  total_hours: number;
  total_cal: number;
}

/** Time-in-sport breakdown (mirrors web getTimeBreakdown). */
interface TimeCategory {
  category: string;
  hours: number;
  sessions: number;
}

/** One session row (mirrors web getAllActivities, labelled type). */
interface ActivityRow {
  activity_id: string;
  label: string;
  date: string;
  name: string | null;
  distance_km: number;
  duration_min: number;
  avg_hr: number | null;
  calories: number | null;
  elev_gain: number;
}

interface ActivitiesSummary {
  totals: { sessions: number; km: number; hours: number; cal: number };
  bySport: SportSummary[];
  timeBreakdown: TimeCategory[];
  recent: ActivityRow[];
  kite?: { topSpeedKts: number; avgSpeedKts: number; totalKm: number; bestJumpM: number; sessions: number } | null;
  snow?: { totalVerticalM: number; topSpeedKmh: number; totalKm: number; days: number } | null;
}

/**
 * soma's multi-sport activity summary (kiteboarding, snowboarding, cycling, etc.).
 * Backed by an /api/activities/summary endpoint added during integration — the web
 * page currently queries the DB directly in a server component, so the universal app
 * consumes a JSON rollup of the same data instead.
 */
function useActivities(range: RangeKey) {
  const [data, setData] = useState<ActivitiesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE}/api/activities/summary?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ActivitiesSummary) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);
  return { data, loading, error };
}

/** Category → bar color, mirroring the web catColors palette. */
const CAT_COLOR: Record<string, string> = {
  Gym: "#e0a458",
  Running: "#6ad4a0",
  Walking: "#82d0c8",
  Cycling: "#cbe896",
  Kite: "#77c8d1",
  Snow: "#8fb8e0",
  Cardio: "#e06060",
  Swim: "#6366b0",
  Other: "#b17bd4",
};

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export default function ActivitiesScreen() {
  const [range, setRange] = useState<RangeKey>("1y");
  const { data, loading, error } = useActivities(range);

  const totals = data?.totals;
  const overview: { label: string; value: string; cls: string }[] = [
    { label: "Sessions", value: `${totals?.sessions ?? "—"}`, cls: "text-teal" },
    { label: "Distance", value: totals && totals.km > 0 ? `${totals.km.toFixed(0)} km` : "—", cls: "text-indigo" },
    { label: "Time", value: totals && totals.hours > 0 ? `${totals.hours.toFixed(0)}h` : "—", cls: "text-lime" },
    { label: "Calories", value: totals && totals.cal > 0 ? `${Math.round(totals.cal).toLocaleString()}` : "—", cls: "text-warm" },
  ];

  const timeTotal = (data?.timeBreakdown ?? []).reduce((s, t) => s + t.hours, 0);

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="gap-1">
          <Text variant="headline">Activities</Text>
          <Text variant="caption" className="text-text-secondary">
            Kiteboarding, snowboarding, cycling & more
          </Text>
        </View>

        <SegmentedControl
          options={RANGES}
          value={range}
          onChange={(v) => setRange(v as RangeKey)}
        />

        {error ? (
          <Card>
            <Text variant="body" className="text-danger">
              API: {error} — is soma running on :3456?
            </Text>
          </Card>
        ) : null}

        {loading && !data ? (
          <Card>
            <Text variant="body" className="text-text-secondary">Loading activities…</Text>
          </Card>
        ) : null}

        {/* Overview totals */}
        <View className="flex-row flex-wrap gap-3">
          {overview.map((s) => (
            <Card key={s.label} className="min-w-[46%] flex-1 gap-1">
              <Text variant="eyebrow">{s.label}</Text>
              <Text variant="headline" className={s.cls}>{s.value}</Text>
            </Card>
          ))}
        </View>

        {/* Kiteboarding deep dive */}
        {data?.kite ? (
          <Card className="gap-3">
            <View className="flex-row items-center gap-2">
              <Text variant="eyebrow">Kiteboarding</Text>
              <Badge label={`${data.kite.sessions} sessions`} tone="teal" />
            </View>
            <View className="flex-row flex-wrap gap-x-6 gap-y-2">
              {[
                ["Top speed", data.kite.topSpeedKts > 0 ? `${data.kite.topSpeedKts.toFixed(1)} kts` : "—"],
                ["Avg max", data.kite.avgSpeedKts > 0 ? `${data.kite.avgSpeedKts.toFixed(1)} kts` : "—"],
                ["Distance", data.kite.totalKm > 0 ? `${data.kite.totalKm.toFixed(0)} km` : "—"],
                ["Best jump", data.kite.bestJumpM > 0 ? `${data.kite.bestJumpM.toFixed(1)} m` : "—"],
              ].map(([label, value]) => (
                <View key={label} className="gap-0.5">
                  <Text variant="micro" className="text-text-muted">{label}</Text>
                  <Text variant="title" className="text-teal">{value}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Snowboarding deep dive */}
        {data?.snow ? (
          <Card className="gap-3">
            <View className="flex-row items-center gap-2">
              <Text variant="eyebrow">Snowboarding</Text>
              <Badge label={`${data.snow.days} days`} tone="neutral" />
            </View>
            <View className="flex-row flex-wrap gap-x-6 gap-y-2">
              {[
                ["Vertical", data.snow.totalVerticalM > 0 ? `${data.snow.totalVerticalM.toLocaleString()} m` : "—"],
                ["Top speed", data.snow.topSpeedKmh > 0 ? `${data.snow.topSpeedKmh.toFixed(0)} km/h` : "—"],
                ["Distance", data.snow.totalKm > 0 ? `${data.snow.totalKm.toFixed(0)} km` : "—"],
              ].map(([label, value]) => (
                <View key={label} className="gap-0.5">
                  <Text variant="micro" className="text-text-muted">{label}</Text>
                  <Text variant="title" className="text-indigo">{value}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Time breakdown by category */}
        {data && data.timeBreakdown.length > 0 ? (
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Time breakdown</Text>
              <Text variant="micro" className="tabular-nums">{Math.round(timeTotal)}h total</Text>
            </View>
            {/* Segmented proportion bar (approximation of the web stacked bar). */}
            <View className="h-3 flex-row overflow-hidden rounded-full">
              {data.timeBreakdown.map((t) => (
                <View
                  key={t.category}
                  style={{
                    flex: timeTotal > 0 ? t.hours / timeTotal : 0,
                    backgroundColor: CAT_COLOR[t.category] ?? "#7a7f8a",
                  }}
                />
              ))}
            </View>
            <View className="gap-2">
              {data.timeBreakdown.map((t) => {
                const pct = timeTotal > 0 ? (t.hours / timeTotal) * 100 : 0;
                return (
                  <View key={t.category} className="gap-1">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <View
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: CAT_COLOR[t.category] ?? "#7a7f8a" }}
                        />
                        <Text variant="caption" className="text-text-secondary">{t.category}</Text>
                      </View>
                      <Text variant="caption" className="tabular-nums text-text">
                        {t.hours.toFixed(0)}h · {t.sessions} · {pct.toFixed(0)}%
                      </Text>
                    </View>
                    <ProgressBar pct={pct / 100} color={CAT_COLOR[t.category] ?? "#7a7f8a"} />
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        {/* Per-sport rollup */}
        {data && data.bySport.length > 0 ? (
          <Card className="gap-2">
            <Text variant="eyebrow">By sport</Text>
            {data.bySport.map((s) => (
              <View
                key={s.label}
                className="flex-row items-center justify-between border-b border-border-subtle py-2"
              >
                <Text variant="body" className="text-text-secondary">{s.label}</Text>
                <Text variant="caption" className="tabular-nums text-text-muted">
                  {s.count} · {s.total_km > 0 ? `${s.total_km.toFixed(0)} km` : "—"} · {s.total_hours.toFixed(0)}h
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Recent activity log */}
        {data && data.recent.length > 0 ? (
          <Card className="gap-2">
            <Text variant="eyebrow">Recent activities</Text>
            {data.recent.slice(0, 15).map((a) => (
              <View
                key={a.activity_id}
                className="flex-row items-center justify-between border-b border-border-subtle py-2"
              >
                <View className="mr-2 flex-1 gap-0.5">
                  <Text variant="caption" className="text-text" numberOfLines={1}>
                    {a.name || a.label}
                  </Text>
                  <Text variant="micro" className="text-text-muted">
                    {a.label} · {fmtDate(a.date)}
                  </Text>
                </View>
                <View className="items-end gap-0.5">
                  <Text variant="caption" className="tabular-nums text-text">
                    {a.distance_km > 0 ? `${a.distance_km.toFixed(1)} km` : fmtDuration(a.duration_min)}
                  </Text>
                  <Text variant="micro" className="tabular-nums text-text-muted">
                    {fmtDuration(a.duration_min)}
                    {a.avg_hr ? ` · ${Math.round(a.avg_hr)} bpm` : ""}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}
