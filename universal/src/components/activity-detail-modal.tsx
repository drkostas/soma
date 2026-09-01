import { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Image, Share } from "react-native";
import { Text, Modal, Badge, SegmentedControl, Button, Sparkline } from "soma-style";
import { LineChart } from "./line-chart";
import { RouteMap } from "./route-map";
import { fetchJson, activityImageSource, type ActivityRow } from "../lib/api";

interface TSPoint { elapsed_sec: number; hr?: number | null; speed?: number | null; elevation?: number | null; cadence?: number | null }
interface GpsPoint { lat?: number | null; lng?: number | null; dist_m?: number | null; hr?: number | null; speed?: number | null; elev?: number | null }

/* ---- response shape from /api/activity/[id] (Garmin summary + laps + weather) ---- */
interface Summary {
  distance?: number | null; duration?: number | null; calories?: number | null;
  averageHR?: number | null; maxHR?: number | null; maxSpeed?: number | null; averageSpeed?: number | null;
  elevationGain?: number | null; elevationLoss?: number | null;
  vO2MaxValue?: number | null; aerobicTrainingEffect?: number | null;
  averageRunningCadenceInStepsPerMinute?: number | null; avgStrideLength?: number | null;
  avgGroundContactTime?: number | null; avgVerticalOscillation?: number | null; avgVerticalRatio?: number | null;
  averagePower?: number | null;
}
interface Lap { distance?: number | null; duration?: number | null; averageSpeed?: number | null; averageHR?: number | null; averageRunCadence?: number | null; elevationGain?: number | null }
interface Zone { zoneNumber: number; secsInZone?: number | null }
interface Gear { gearTypeName?: string; customMakeModel?: string | null; displayName?: string | null; maximumMeters?: number | null; gearStatusName?: string | null }
interface ActivityDetail {
  summary?: Summary | null;
  hr_zones?: Zone[] | null;
  weather?: { temp?: number | null; relativeHumidity?: number | null; windSpeed?: number | null; windDirectionCompassPoint?: string | null; weatherTypeDTO?: { desc?: string } | null } | null;
  splits?: { lapDTOs?: Lap[] } | null;
  gear?: Gear[] | null;
  strava_id?: string | null;
  time_series?: TSPoint[] | null;
  gps_route?: GpsPoint[] | null;
}

const n = (v: number | null | undefined): number => (v == null || !isFinite(Number(v)) ? 0 : Number(v));
const ZONE_COLOR = ["#77c8d1", "#6ad4a0", "#e0c458", "#e0a458", "#e06060"];
function hm(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "—";
  const t = Math.round(sec); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
}
function secMMSS(sec: number): string { const t = Math.round(sec); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; }
function paceFromMs(ms: number | null | undefined): string { if (ms == null || ms <= 0) return "—"; const secKm = 1000 / ms; return `${secMMSS(secKm)}/km`; }
function kmh(ms: number | null | undefined): string { return ms == null ? "—" : `${(ms * 3.6).toFixed(1)} km/h`; }
function longDate(iso: string | null | undefined): string { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
function prettyKey(k: string): string { return k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()).trim(); }
function fmtVal(v: number | string | boolean): string { return typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v); }

const PERF_METRICS = ["HR", "Pace", "Elevation", "Cadence"] as const;
type PerfMetric = typeof PERF_METRICS[number];
const PERF_CFG: Record<PerfMetric, { color: string; get: (p: TSPoint) => number | null; fmt: (v: number) => string }> = {
  HR:        { color: "#e06060", get: (p) => (p.hr != null && p.hr > 0 ? p.hr : null), fmt: (v) => `${Math.round(v)}` },
  Pace:      { color: "#77c8d1", get: (p) => (p.speed != null && p.speed > 0.5 ? 1000 / p.speed : null), fmt: (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}` },
  Elevation: { color: "#8fc866", get: (p) => (p.elevation != null ? p.elevation : null), fmt: (v) => `${Math.round(v)}` },
  Cadence:   { color: "#e0a458", get: (p) => (p.cadence != null && p.cadence > 0 ? p.cadence : null), fmt: (v) => `${Math.round(v)}` },
};

/** In-activity time-series charts (web activity-performance-chart parity): one
 *  metric at a time (HR / pace / elevation / cadence) over elapsed time, from the
 *  per-second time_series (downsampled). Pace is min/km, so lower is faster. */
function PerfCharts({ ts }: { ts: TSPoint[] }) {
  const [metric, setMetric] = useState<PerfMetric>("HR");
  // Only offer metrics that actually have data.
  const available = PERF_METRICS.filter((m) => ts.some((p) => PERF_CFG[m].get(p) != null));
  const active: PerfMetric = available.includes(metric) ? metric : (available[0] ?? "HR");
  const cfg = PERF_CFG[active];
  const { values, labels } = useMemo(() => {
    const step = Math.max(1, Math.ceil(ts.length / 120));
    const pts = ts.filter((_, i) => i % step === 0);
    return {
      values: pts.map((p) => cfg.get(p)),
      labels: pts.map((p) => `${Math.round(p.elapsed_sec / 60)}m`),
    };
  }, [ts, active]);

  if (available.length === 0) return <Text variant="caption" className="text-text-muted">No time-series for this activity.</Text>;
  return (
    <View className="gap-2">
      <SegmentedControl options={available} value={active} onChange={(v) => setMetric(v as PerfMetric)} />
      <LineChart height={180} interactive xTicks={4} labels={labels} yFormat={cfg.fmt}
        series={[{ values, color: cfg.color, width: 2 }]} />
      <Text variant="micro" className="text-text-muted">{active === "Pace" ? "min/km over elapsed time — lower is faster." : `${active} over elapsed time.`}</Text>
    </View>
  );
}

/** Route profile (web run-sparklines parity): elevation / pace / HR traced
 *  against DISTANCE (binned by km) from the gps_route — the shape of the run,
 *  complementing the Charts tab's over-time view. */
function RouteProfile({ gps }: { gps: GpsPoint[] }) {
  const prof = useMemo(() => {
    const pts = gps.filter((p) => p.dist_m != null);
    const maxDist = pts.length ? Number(pts[pts.length - 1].dist_m) || 0 : 0;
    if (pts.length < 4 || maxDist <= 0) return null;
    const BINS = 40;
    const elev: number[] = [], pace: number[] = [], hr: number[] = [];
    for (let b = 0; b < BINS; b++) {
      const lo = (b / BINS) * maxDist, hi = ((b + 1) / BINS) * maxDist;
      const inBin = pts.filter((p) => { const d = Number(p.dist_m) || 0; return d >= lo && d < hi; });
      if (!inBin.length) continue;
      const avg = (f: (p: GpsPoint) => number | null) => {
        const vs = inBin.map(f).filter((v): v is number => v != null && isFinite(v));
        return vs.length ? vs.reduce((a, c) => a + c, 0) / vs.length : null;
      };
      const e = avg((p) => (p.elev != null ? Number(p.elev) : null)); if (e != null) elev.push(e);
      const sp = avg((p) => (p.speed != null && Number(p.speed) > 0.5 ? 1000 / Number(p.speed) : null)); if (sp != null) pace.push(sp);
      const h = avg((p) => (p.hr != null ? Number(p.hr) : null)); if (h != null) hr.push(h);
    }
    return { elev, pace, hr, km: maxDist / 1000 };
  }, [gps]);
  if (!prof || (prof.elev.length < 2 && prof.pace.length < 2 && prof.hr.length < 2)) return null;

  const row = (label: string, data: number[], color: string, unit: string, fmt: (v: number) => string) =>
    data.length >= 2 ? (
      <View className="gap-0.5">
        <View className="flex-row items-center justify-between">
          <Text variant="micro" className="text-text-muted">{label}</Text>
          <Text variant="micro" className="tabular-nums text-text-muted">{fmt(Math.min(...data))}–{fmt(Math.max(...data))} {unit}</Text>
        </View>
        <Sparkline data={data} color={color} height={30} baseline />
      </View>
    ) : null;

  return (
    <View className="gap-2 border-t border-border-subtle pt-2.5">
      <Text variant="eyebrow" className="text-text-muted">Route profile · {prof.km.toFixed(1)} km · by distance</Text>
      {row("Elevation", prof.elev, "#8fc866", "m", (v) => `${Math.round(v)}`)}
      {row("Pace", prof.pace, "#77c8d1", "/km", (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`)}
      {row("Heart rate", prof.hr, "#e06060", "bpm", (v) => `${Math.round(v)}`)}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[30%] flex-1 gap-0.5">
      <Text variant="micro" className="text-text-muted">{label}</Text>
      <Text variant="body" className="tabular-nums text-text">{value}</Text>
    </View>
  );
}

/**
 * Rich activity detail (web parity): fetches /api/activity/[id] and renders the
 * full Garmin metric grid, HR-zone bars, weather, gear, and a per-lap splits
 * tab. Falls back to the passed-in row's fields for the header while loading.
 */
export function ActivityDetailModal({ activity, onClose }: { activity: ActivityRow | null; onClose: () => void }) {
  const [data, setData] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"Overview" | "Map" | "Splits" | "Charts" | "Details" | "Share">("Overview");

  useEffect(() => {
    if (!activity) { setData(null); return; }
    let alive = true; setLoading(true); setTab("Overview");
    fetchJson<ActivityDetail>(`/api/activity/${activity.activity_id}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        // Web opens on the Map tab when there's a GPS route (defaultValue).
        const rp = (d?.gps_route ?? []).filter((p) => p != null && p.lat != null && p.lng != null);
        if (rp.length > 10) setTab("Map");
      })
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [activity]);

  if (!activity) return null;
  const s = data?.summary ?? null;
  const tkey = (activity.type_key || "").toLowerCase();
  const isRun = tkey === "running" || tkey === "treadmill_running";
  const isStrengthAct = tkey === "strength_training";
  const isKiteAct = tkey.includes("kite");
  const laps = data?.splits?.lapDTOs ?? [];
  const ts = data?.time_series ?? [];
  const hasTS = ts.length > 1;
  const routePts = (data?.gps_route ?? []).filter((p): p is { lat: number; lng: number; speed?: number | null } => p != null && p.lat != null && p.lng != null && isFinite(Number(p.lat)) && isFinite(Number(p.lng))).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), speed: p.speed }));
  const hasRoute = routePts.length > 10; // web run-map bar: needs >10 points
  // Web tab order: Map (first, when present), Overview, Charts, Splits, Details, Share.
  const tabOptions = [...(hasRoute ? ["Map"] : []), "Overview", ...(hasTS ? ["Charts"] : []), ...(laps.length > 1 ? ["Splits"] : []), ...(s ? ["Details"] : []), "Share"];
  const img = activityImageSource(activity.activity_id);
  const onShare = () => { Share.share({ url: img.uri, message: activity.name || activity.sport }).catch(() => {}); };
  const zones = (data?.hr_zones ?? []).filter((z) => z && (z.secsInZone ?? 0) > 0);
  const zTotal = zones.reduce((a, z) => a + n(z.secsInZone), 0);
  const shoe = (data?.gear ?? []).find((g) => g.gearTypeName === "Shoes");
  const w = data?.weather;
  // lap pace range for the bar colouring
  const lapPaces = laps.map((l) => (l.averageSpeed && l.averageSpeed > 0 ? 1000 / l.averageSpeed : null)).filter((v): v is number => v != null);
  const minP = lapPaces.length ? Math.min(...lapPaces) : 0;
  const maxP = lapPaces.length ? Math.max(...lapPaces) : 1;
  const rangeP = maxP - minP || 1;

  const metrics: [string, string][] = s ? ([
    ["Distance", s.distance != null ? `${(n(s.distance) / 1000).toFixed(2)} km` : "—"],
    ["Duration", hm(s.duration)],
    ["Avg pace", isRun ? paceFromMs(s.averageSpeed) : "—"],
    ["Max speed", !isRun && !isStrengthAct && s.maxSpeed != null ? (isKiteAct ? `${(n(s.maxSpeed) * 1.94384).toFixed(1)} kts` : kmh(s.maxSpeed)) : "—"],
    ["Avg HR", s.averageHR != null ? `${Math.round(n(s.averageHR))} bpm` : "—"],
    ["Max HR", s.maxHR != null ? `${Math.round(n(s.maxHR))} bpm` : "—"],
    ["Elev gain", s.elevationGain != null ? `↑ ${Math.round(n(s.elevationGain))} m` : "—"],
    ["Elev loss", s.elevationLoss != null ? `↓ ${Math.round(n(s.elevationLoss))} m` : "—"],
    ["Calories", s.calories != null ? `${Math.round(n(s.calories))} kcal` : "—"],
    ["VO₂max", s.vO2MaxValue != null ? n(s.vO2MaxValue).toFixed(1) : "—"],
    ["Aerobic TE", s.aerobicTrainingEffect != null ? n(s.aerobicTrainingEffect).toFixed(1) : "—"],
    ["Cadence", s.averageRunningCadenceInStepsPerMinute != null ? `${Math.round(n(s.averageRunningCadenceInStepsPerMinute))} spm` : "—"],
    ["Stride", s.avgStrideLength != null ? `${Math.round(n(s.avgStrideLength))} cm` : "—"],
    ["Grnd contact", s.avgGroundContactTime != null ? `${Math.round(n(s.avgGroundContactTime))} ms` : "—"],
    ["Vert osc", s.avgVerticalOscillation != null ? `${n(s.avgVerticalOscillation).toFixed(1)} cm` : "—"],
    ["Vert ratio", s.avgVerticalRatio != null ? `${n(s.avgVerticalRatio).toFixed(1)}%` : "—"],
    ["Avg power", s.averagePower != null ? `${Math.round(n(s.averagePower))} W` : "—"],
  ] as [string, string][]).filter(([, v]) => v !== "—") : [];

  return (
    <Modal visible={!!activity} onClose={onClose} title={activity.name || activity.sport}>
      <View className="gap-3" style={{ maxHeight: 560 }}>
        <View className="flex-row items-center gap-2">
          <Badge label={activity.sport} tone="teal" />
          <Text variant="micro" className="text-text-muted">{longDate(activity.date)}</Text>
          {data?.strava_id ? <Badge label="On Strava" tone="success" /> : null}
        </View>

        {loading && !data ? (
          <Text variant="body" className="text-text-muted">Loading…</Text>
        ) : null}

        {tabOptions.length > 1 ? (
          <SegmentedControl options={tabOptions} value={tab} onChange={(v) => setTab(v as "Overview" | "Map" | "Splits" | "Charts" | "Details" | "Share")} />
        ) : null}

        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          {tab === "Overview" ? (
            <View className="gap-3">
              {/* metric grid (rich) or fall back to the row's basics */}
              <View className="flex-row flex-wrap gap-y-3">
                {metrics.length ? (
                  metrics.map(([label, value]) => <Metric key={label} label={label} value={value} />)
                ) : (
                  <>
                    <Metric label="Distance" value={activity.distance_km != null ? `${n(activity.distance_km).toFixed(2)} km` : "—"} />
                    <Metric label="Duration" value={activity.duration_min != null ? `${Math.round(n(activity.duration_min))} min` : "—"} />
                    <Metric label="Avg HR" value={activity.avg_hr != null ? `${Math.round(n(activity.avg_hr))} bpm` : "—"} />
                    <Metric label="Calories" value={activity.calories != null ? `${Math.round(n(activity.calories))} kcal` : "—"} />
                    <Metric label="Elevation" value={activity.elev_gain > 0 ? `↑ ${Math.round(activity.elev_gain)} m` : "—"} />
                  </>
                )}
              </View>

              {/* HR zones */}
              {zones.length && zTotal > 0 ? (
                <View className="gap-1.5 border-t border-border-subtle pt-2">
                  <Text variant="eyebrow" className="text-text-muted">Heart-rate zones</Text>
                  {zones.map((z) => {
                    const pct = (n(z.secsInZone) / zTotal) * 100;
                    return (
                      <View key={z.zoneNumber} className="flex-row items-center gap-2">
                        <Text variant="micro" className="w-6 text-text-muted">Z{z.zoneNumber}</Text>
                        <View className="flex-1 h-2.5 rounded-full bg-surface-subtle overflow-hidden">
                          <View className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: ZONE_COLOR[z.zoneNumber - 1] ?? ZONE_COLOR[0] }} />
                        </View>
                        <Text variant="micro" className="tabular-nums text-text-muted w-20 text-right">{secMMSS(n(z.secsInZone))} · {Math.round(pct)}%</Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* Weather */}
              {w && (w.temp != null || w.windSpeed != null) ? (
                <View className="gap-1 border-t border-border-subtle pt-2">
                  <Text variant="eyebrow" className="text-text-muted">Weather</Text>
                  <Text variant="micro" className="text-text-secondary">
                    {w.temp != null ? `${Math.round(n(w.temp))}°C` : ""}
                    {w.relativeHumidity != null ? ` · ${Math.round(n(w.relativeHumidity))}% humidity` : ""}
                    {w.windSpeed != null ? ` · wind ${(n(w.windSpeed) * 3.6).toFixed(0)} km/h ${w.windDirectionCompassPoint ?? ""}` : ""}
                    {w.weatherTypeDTO?.desc ? ` · ${w.weatherTypeDTO.desc}` : ""}
                  </Text>
                </View>
              ) : null}

              {/* Gear */}
              {shoe ? (
                <View className="gap-0.5 border-t border-border-subtle pt-2">
                  <Text variant="eyebrow" className="text-text-muted">Gear</Text>
                  <Text variant="micro" className="text-text-secondary">
                    {shoe.customMakeModel || shoe.displayName || "Shoe"}
                    {shoe.maximumMeters && shoe.maximumMeters > 0 ? ` · ${Math.round(n(shoe.maximumMeters) / 1000)} km max` : ""}
                    {shoe.gearStatusName ? ` · ${shoe.gearStatusName}` : ""}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : tab === "Map" ? (
            <View className="gap-2">
              <RouteMap points={routePts} height={340} />
              <RouteProfile gps={data?.gps_route ?? []} />
            </View>
          ) : tab === "Charts" ? (
            <View className="gap-3">
              <PerfCharts ts={ts} />
              <RouteProfile gps={data?.gps_route ?? []} />
            </View>
          ) : tab === "Share" ? (
            <View className="items-center gap-3">
              <Image source={img} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: "#0e1a22" }} resizeMode="contain" />
              <Button label="Share activity" onPress={onShare} />
              <Text variant="micro" className="text-center text-text-muted">A shareable card for this activity.</Text>
            </View>
          ) : tab === "Details" ? (
            <View className="gap-1">
              {s ? Object.entries(s)
                .filter(([k, v]) => v != null && v !== 0 && v !== "" && typeof v !== "object" && !["activityUUID", "userProfilePK", "deviceId"].includes(k))
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([k, v]) => (
                  <View key={k} className="flex-row justify-between gap-3 border-b border-border-subtle py-1">
                    <Text variant="micro" className="text-text-muted">{prettyKey(k)}</Text>
                    <Text variant="micro" className="tabular-nums text-text" numberOfLines={1} style={{ flexShrink: 1 }}>{fmtVal(v as number | string | boolean)}</Text>
                  </View>
                )) : <Text variant="caption" className="text-text-muted">No detail fields.</Text>}
            </View>
          ) : (
            /* Splits tab: per-lap pace bars + stats */
            <View className="gap-1.5">
              {laps.map((l, i) => {
                const p = l.averageSpeed && l.averageSpeed > 0 ? 1000 / l.averageSpeed : null;
                const t = p != null ? (p - minP) / rangeP : 0;
                const color = t < 0.4 ? "#6ad4a0" : t < 0.7 ? "#e0c458" : "#e0a458";
                return (
                  <View key={i} className="gap-0.5 py-0.5">
                    <View className="flex-row items-center gap-2">
                      <Text variant="micro" className="w-8 tabular-nums text-text-muted">{i + 1}</Text>
                      <View className="flex-1 h-2.5 rounded-full bg-surface-subtle overflow-hidden">
                        <View className="h-full rounded-full" style={{ width: `${p != null ? Math.max(6, (1 - t) * 100) : 6}%`, backgroundColor: color }} />
                      </View>
                      <Text variant="micro" className="w-16 text-right tabular-nums text-text">{paceFromMs(l.averageSpeed)}</Text>
                    </View>
                    <Text variant="micro" className="pl-10 tabular-nums text-text-muted">
                      {l.distance != null ? `${(n(l.distance) / 1000).toFixed(2)} km` : ""}
                      {l.averageHR != null ? ` · ${Math.round(n(l.averageHR))} bpm` : ""}
                      {l.averageRunCadence != null ? ` · ${Math.round(n(l.averageRunCadence))} spm` : ""}
                      {l.elevationGain != null && l.elevationGain > 0 ? ` · ↑${Math.round(n(l.elevationGain))}m` : ""}
                    </Text>
                  </View>
                );
              })}
              {/* Summary footer (web parity): split count + averages */}
              {laps.length ? (
                <View className="mt-1 flex-row items-center justify-between border-t border-border-subtle pt-2">
                  <Text variant="micro" className="text-text-muted">{laps.length} splits</Text>
                  <View className="flex-row gap-3">
                    {s?.averageSpeed ? <Text variant="micro" className="tabular-nums text-text-secondary">{paceFromMs(s.averageSpeed)} avg</Text> : null}
                    {s?.averageHR ? <Text variant="micro" className="tabular-nums text-text-muted">{Math.round(n(s.averageHR))} bpm</Text> : null}
                    {s?.duration ? <Text variant="micro" className="tabular-nums text-text-muted">{hm(s.duration)}</Text> : null}
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
