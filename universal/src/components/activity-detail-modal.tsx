import { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Image, Pressable, Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Text, Modal, Badge, Button, Sparkline } from "soma-style";
import { LineChart, type ChartSeries } from "./line-chart";
import { RouteMap } from "./route-map";
import { TabStrip } from "./tab-strip";
import { fetchJson, activityImageSource, uploadActivityPhotoToStrava, type ActivityRow } from "../lib/api";

interface TSPoint { elapsed_sec: number; hr?: number | null; speed?: number | null; elevation?: number | null; cadence?: number | null; power?: number | null; respiration?: number | null; stride?: number | null }
interface GpsPoint { lat?: number | null; lng?: number | null; dist_m?: number | null; hr?: number | null; speed?: number | null; elev?: number | null; cadence?: number | null }

/* ---- response shape from /api/activity/[id] (Garmin summary + laps + weather) ---- */
interface Summary {
  activityName?: string | null;
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
/** Web's header date: "Wednesday, September 2, 2026". */
function longDate(iso: string | null | undefined): string { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
function prettyKey(k: string): string { return k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()).trim(); }
function fmtVal(v: number | string | boolean): string { return typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v); }
const mmss = (v: number) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`;

/* ---- Charts tab: web's activity-performance-chart (7 metrics, overlay, reversed pace axis) ---- */
const PERF_METRICS = ["Pace", "HR", "Elevation", "Cadence", "Power", "Breathing", "Stride"] as const;
type PerfMetric = typeof PERF_METRICS[number];
const PERF_CFG: Record<PerfMetric, { color: string; unit: string; invert?: boolean; area?: boolean; get: (p: TSPoint) => number | null; fmt: (v: number) => string }> = {
  Pace:      { color: "#77c8d1", unit: "/km", invert: true, get: (p) => (p.speed != null && p.speed > 0.3 ? 1000 / p.speed : null), fmt: mmss },
  HR:        { color: "#e06060", unit: "bpm", get: (p) => (p.hr != null && p.hr > 0 ? p.hr : null), fmt: (v) => `${Math.round(v)}` },
  Elevation: { color: "#8fc866", unit: "m", area: true, get: (p) => (p.elevation != null ? p.elevation : null), fmt: (v) => `${Math.round(v)}` },
  Cadence:   { color: "#e0a458", unit: "spm", get: (p) => (p.cadence != null && p.cadence >= 100 ? p.cadence : null), fmt: (v) => `${Math.round(v)}` },
  Power:     { color: "#cbe896", unit: "W", get: (p) => (p.power != null && p.power > 0 ? p.power : null), fmt: (v) => `${Math.round(v)}` },
  Breathing: { color: "#8b9df0", unit: "br/min", get: (p) => (p.respiration != null && p.respiration > 0 ? p.respiration : null), fmt: (v) => `${Math.round(v)}` },
  Stride:    { color: "#c084fc", unit: "cm", get: (p) => (p.stride != null && p.stride > 0 ? Math.round(p.stride * 100) : null), fmt: (v) => `${Math.round(v)}` },
};

function PerfCharts({ ts }: { ts: TSPoint[] }) {
  const available = PERF_METRICS.filter((m) => ts.some((p) => PERF_CFG[m].get(p) != null));
  const [primary, setPrimary] = useState<PerfMetric>("Pace");
  const [overlay, setOverlay] = useState<PerfMetric | "none">("HR");
  const prim: PerfMetric = available.includes(primary) ? primary : (available[0] ?? "HR");
  const over: PerfMetric | null = overlay !== "none" && overlay !== prim && available.includes(overlay) ? overlay : null;
  // Web: 300 points, the last one always kept, so the end of the activity survives.
  const { pts, labels } = useMemo(() => {
    const step = Math.max(1, Math.ceil(ts.length / 300));
    const kept = ts.filter((_, i) => i % step === 0 || i === ts.length - 1);
    return { pts: kept, labels: kept.map((p) => `${Math.round(p.elapsed_sec / 60)}m`) };
  }, [ts]);
  if (available.length === 0) return <Text variant="caption" className="text-text-muted">No time-series for this activity.</Text>;
  const pc = PERF_CFG[prim]; const oc = over ? PERF_CFG[over] : null;
  const series: ChartSeries[] = [
    { values: pts.map((p) => pc.get(p)), color: pc.color, width: 2, label: prim, area: pc.area },
    ...(over && oc ? [{ values: pts.map((p) => oc.get(p)), color: oc.color, width: 1.6, label: over, axis: "right" as const }] : []),
  ];
  return (
    <View className="gap-2">
      <TabStrip tabs={available.map((k) => ({ key: k }))} value={prim} onChange={(k) => { setPrimary(k as PerfMetric); if (k === overlay) setOverlay("none"); }} />
      <View className="flex-row items-center gap-2">
        <Text variant="micro" className="text-text-muted">overlay</Text>
        <View className="flex-1">
          <TabStrip tabs={[{ key: "none" }, ...available.filter((k) => k !== prim).map((k) => ({ key: k }))]} value={over ?? "none"} onChange={(k) => setOverlay(k as PerfMetric | "none")} />
        </View>
      </View>
      <LineChart height={190} interactive xTicks={4} labels={labels} yFormat={pc.fmt} yFormatRight={oc?.fmt} invertY={!!pc.invert} series={series} />
      <Text variant="micro" className="text-text-muted">
        {prim} ({pc.unit}){over && oc ? ` · ${over} (${oc.unit}) on the right axis` : ""} over elapsed time{pc.invert ? " · faster is higher" : ""}.
      </Text>
    </View>
  );
}

/** Route profile (web run-sparklines parity): elevation / pace / HR / cadence against
 *  DISTANCE (binned) from the gps_route. Pace keeps web's 2:45–14:00 min/km artefact
 *  filter, cadence its ≥100 spm filter, and the HR row takes web's colour for its mean. */
function RouteProfile({ gps }: { gps: GpsPoint[] }) {
  const prof = useMemo(() => {
    const pts = gps.filter((p) => p.dist_m != null);
    const maxDist = pts.length ? Number(pts[pts.length - 1].dist_m) || 0 : 0;
    if (pts.length < 4 || maxDist <= 0) return null;
    const BINS = 40;
    const elev: number[] = [], pace: number[] = [], hr: number[] = [], cad: number[] = [];
    for (let b = 0; b < BINS; b++) {
      const lo = (b / BINS) * maxDist, hi = ((b + 1) / BINS) * maxDist;
      const inBin = pts.filter((p) => { const d = Number(p.dist_m) || 0; return d >= lo && d < hi; });
      if (!inBin.length) continue;
      const avg = (f: (p: GpsPoint) => number | null) => {
        const vs = inBin.map(f).filter((v): v is number => v != null && isFinite(v));
        return vs.length ? vs.reduce((a, c) => a + c, 0) / vs.length : null;
      };
      const e = avg((p) => (p.elev != null ? Number(p.elev) : null)); if (e != null) elev.push(e);
      const sp = avg((p) => { const s = Number(p.speed); if (!(s > 0)) return null; const sk = 1000 / s; return sk >= 165 && sk <= 840 ? sk : null; }); if (sp != null) pace.push(sp);
      const h = avg((p) => (p.hr != null ? Number(p.hr) : null)); if (h != null) hr.push(h);
      const c = avg((p) => (p.cadence != null && Number(p.cadence) >= 100 ? Number(p.cadence) : null)); if (c != null) cad.push(c);
    }
    return { elev, pace, hr, cad, km: maxDist / 1000 };
  }, [gps]);
  if (!prof || (prof.elev.length < 2 && prof.pace.length < 2 && prof.hr.length < 2)) return null;
  const hrMean = prof.hr.length ? prof.hr.reduce((a, b) => a + b, 0) / prof.hr.length : 0;
  const hrColor = hrMean < 120 ? "#64748b" : hrMean < 140 ? "#3b82f6" : hrMean < 155 ? "#22c55e" : hrMean < 170 ? "#f97316" : "#ef4444";

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
      {row("Pace", prof.pace, "#77c8d1", "/km", mmss)}
      {row("Heart rate", prof.hr, hrColor, "bpm", (v) => `${Math.round(v)}`)}
      {row("Cadence", prof.cad, "#e0a458", "spm", (v) => `${Math.round(v)}`)}
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

/* ---- Share tab: web's branding toggle, download and Strava upload ---- */
function ShareTab({ activityId, title, stravaId }: { activityId: string; title: string; stravaId: string | null | undefined }) {
  const [branding, setBranding] = useState(true);
  const [imgState, setImgState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<{ state: "idle" | "uploading" | "done" | "error"; error?: string }>({ state: "idle" });
  const img = activityImageSource(activityId, branding);
  const slug = `${(title || "activity").replace(/\s+/g, "-").toLowerCase()}.png`;

  const onSaveShare = async () => {
    setSaving(true);
    try {
      if (Platform.OS === "web") { await Share.share({ url: img.uri, message: title }).catch(() => {}); return; }
      // Web offers "Download PNG"; on a phone the equivalent is the rendered file in the
      // share sheet (save to gallery, send, …) — not a bare URL the recipient cannot open.
      const target = `${FileSystem.cacheDirectory ?? ""}${slug}`;
      const res = await FileSystem.downloadAsync(img.uri, target, { headers: img.headers });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(res.uri, { mimeType: "image/png", dialogTitle: title });
      else await Share.share({ url: res.uri, message: title }).catch(() => {});
    } catch { /* the share sheet was dismissed or the download failed; nothing to persist */ }
    finally { setSaving(false); }
  };
  const onUpload = async () => {
    setUpload({ state: "uploading" });
    const r = await uploadActivityPhotoToStrava(activityId, branding);
    setUpload(r.ok ? { state: "done" } : { state: "error", error: r.error });
  };
  const uploadLabel = upload.state === "uploading" ? "Uploading…" : upload.state === "done" ? "Uploaded to Strava" : "Upload to Strava";
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="micro" className="text-text-muted">Show branding</Text>
        <TabStrip tabs={[{ key: "On" }, { key: "Off" }]} value={branding ? "On" : "Off"} onChange={(k) => { setBranding(k === "On"); setImgState("loading"); }} />
      </View>
      <View style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: "#0e1a22", overflow: "hidden" }}>
        <Image key={img.uri} source={img} style={{ width: "100%", height: "100%" }} resizeMode="contain" onLoadStart={() => setImgState("loading")} onLoad={() => setImgState("ready")} onError={() => setImgState("error")} />
        {imgState !== "ready" ? (
          <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
            <Text variant="caption" className="text-text-muted">{imgState === "error" ? "The card could not be rendered." : "Rendering the card…"}</Text>
          </View>
        ) : null}
      </View>
      <Button label={saving ? "Preparing…" : "Save / share PNG"} onPress={onSaveShare} disabled={saving || imgState !== "ready"} />
      <View className="gap-1">
        <Button label={uploadLabel} variant="secondary" onPress={onUpload} disabled={!stravaId || upload.state === "uploading" || upload.state === "done"} />
        {!stravaId ? <Text variant="micro" className="text-center text-text-muted">Sync to Strava first from the Connections page</Text> : null}
        {upload.state === "error" && upload.error ? <Text variant="micro" className="text-center text-danger">{upload.error}</Text> : null}
      </View>
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
  const [tab, setTab] = useState<string>("Overview");

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
  const title = s?.activityName || activity.name || activity.sport;
  const tkey = (activity.type_key || "").toLowerCase();
  const isRun = tkey === "running" || tkey === "treadmill_running";
  const isStrengthAct = tkey === "strength_training";
  const isKiteAct = tkey.includes("kite") || tkey.includes("wind");
  const laps = data?.splits?.lapDTOs ?? [];
  const hasLaps = laps.length > 1 && n(laps[0]?.distance) > 0;
  const ts = data?.time_series ?? [];
  const hasTS = ts.length > 1;
  const routePts = (data?.gps_route ?? []).filter((p): p is { lat: number; lng: number; speed?: number | null } => p != null && p.lat != null && p.lng != null && isFinite(Number(p.lat)) && isFinite(Number(p.lng))).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), speed: p.speed }));
  const hasRoute = routePts.length > 10; // web run-map bar: needs >10 points
  // Web tab order: Map (first, when present), Overview, Charts, Splits (disabled without laps), Details, Share.
  const tabs = [...(hasRoute ? [{ key: "Map" }] : []), { key: "Overview" }, ...(hasTS ? [{ key: "Charts" }] : []), { key: "Splits", disabled: !hasLaps }, { key: "Details", disabled: !s }, { key: "Share" }];
  const zones = (data?.hr_zones ?? []).filter((z) => z && (z.secsInZone ?? 0) > 0);
  const zTotal = zones.reduce((a, z) => a + n(z.secsInZone), 0);
  const shoe = (data?.gear ?? []).find((g) => g.gearTypeName === "Shoes");
  const w = data?.weather;
  // Lap pace vs the activity average: web colours a split green under 97 % and red over 103 % of it.
  const lapPaces = laps.map((l) => (l.averageSpeed && l.averageSpeed > 0 ? 1000 / l.averageSpeed : null));
  const paceVals = lapPaces.filter((v): v is number => v != null);
  const avgPace = paceVals.length ? paceVals.reduce((a, b) => a + b, 0) / paceVals.length : null;
  const minP = paceVals.length ? Math.min(...paceVals) : 0;
  const maxP = paceVals.length ? Math.max(...paceVals) : 1;
  const rangeP = maxP - minP || 1;
  const hasDynamics = isRun && n(s?.avgGroundContactTime) > 0;

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
    ...(hasDynamics ? [] : ([
      ["Grnd contact", s.avgGroundContactTime != null ? `${Math.round(n(s.avgGroundContactTime))} ms` : "—"],
      ["Vert osc", s.avgVerticalOscillation != null ? `${n(s.avgVerticalOscillation).toFixed(1)} cm` : "—"],
      ["Vert ratio", s.avgVerticalRatio != null ? `${n(s.avgVerticalRatio).toFixed(1)}%` : "—"],
      ["Avg power", s.averagePower != null ? `${Math.round(n(s.averagePower))} W` : "—"],
    ] as [string, string][])),
  ] as [string, string][]).filter(([, v]) => v !== "—") : [];
  const dynamics: [string, string][] = hasDynamics && s ? ([
    ["Ground contact", `${Math.round(n(s.avgGroundContactTime))} ms`],
    ["Vert oscillation", s.avgVerticalOscillation != null ? `${n(s.avgVerticalOscillation).toFixed(1)} cm` : "—"],
    ["Vert ratio", s.avgVerticalRatio != null ? `${n(s.avgVerticalRatio).toFixed(1)}%` : "—"],
    ["Avg power", s.averagePower != null ? `${Math.round(n(s.averagePower))} W` : "—"],
  ] as [string, string][]).filter(([, v]) => v !== "—") : [];

  return (
    <Modal visible={!!activity} onClose={onClose} title={title}>
      <View className="gap-3" style={{ maxHeight: 560 }}>
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge label={activity.sport} tone="teal" />
          <Text variant="micro" className="text-text-muted">{longDate(activity.date)}</Text>
          {data?.strava_id ? <Badge label="On Strava" tone="success" /> : null}
        </View>

        {loading && !data ? (
          <Text variant="body" className="text-text-muted">Loading…</Text>
        ) : null}

        <TabStrip tabs={tabs} value={tab} onChange={setTab} />

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

              {/* Running dynamics (web: its own section under the grid) */}
              {dynamics.length ? (
                <View className="gap-1.5 border-t border-border-subtle pt-2">
                  <Text variant="eyebrow" className="text-text-muted">Running dynamics</Text>
                  <View className="flex-row flex-wrap gap-y-3">
                    {dynamics.map(([label, value]) => <Metric key={label} label={label} value={value} />)}
                  </View>
                </View>
              ) : null}

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

              {/* Weather — Garmin reports °F and mph; web converts the temperature and shows knots for wind sports */}
              {w && (w.temp != null || w.windSpeed != null) ? (
                <View className="gap-1 border-t border-border-subtle pt-2">
                  <Text variant="eyebrow" className="text-text-muted">Weather</Text>
                  <Text variant="micro" className="text-text-secondary">
                    {w.temp != null ? `${Math.round((n(w.temp) - 32) * 5 / 9)}°C` : ""}
                    {w.relativeHumidity != null ? ` · ${Math.round(n(w.relativeHumidity))}% humidity` : ""}
                    {w.windSpeed != null && n(w.windSpeed) > 0 ? ` · wind ${isKiteAct ? `${(n(w.windSpeed) * 0.868976).toFixed(1)} kts` : `${Math.round(n(w.windSpeed))} mph`}${w.windDirectionCompassPoint ? ` ${w.windDirectionCompassPoint.toUpperCase()}` : ""}` : ""}
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
            <ShareTab activityId={activity.activity_id} title={title} stravaId={data?.strava_id} />
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
            /* Splits tab: web's table — # · Dist · Pace · HR · Time · More — with the pace bar kept */
            <View className="gap-1.5">
              <View className="flex-row items-center gap-2 border-b border-border-subtle pb-1">
                <Text variant="micro" className="w-6 text-text-muted">#</Text>
                <Text variant="micro" className="flex-1 text-text-muted">Pace</Text>
                <Text variant="micro" className="w-14 text-right text-text-muted">HR</Text>
                <Text variant="micro" className="w-14 text-right text-text-muted">Time</Text>
              </View>
              {laps.map((l, i) => {
                const p = lapPaces[i];
                const t = p != null ? (p - minP) / rangeP : 0;
                const color = p != null && avgPace ? (p < avgPace * 0.97 ? "#6ad4a0" : p > avgPace * 1.03 ? "#e06060" : "#77c8d1") : "#77c8d1";
                return (
                  <View key={i} className="gap-0.5 py-0.5">
                    <View className="flex-row items-center gap-2">
                      <Text variant="micro" className="w-6 tabular-nums text-text-muted">{i + 1}</Text>
                      <View className="flex-1 flex-row items-center gap-2">
                        <View className="flex-1 h-2.5 rounded-full bg-surface-subtle overflow-hidden">
                          <View className="h-full rounded-full" style={{ width: `${p != null ? Math.max(6, (1 - t) * 100) : 6}%`, backgroundColor: color }} />
                        </View>
                        <Text variant="micro" className="w-16 text-right tabular-nums" style={{ color }}>{paceFromMs(l.averageSpeed)}</Text>
                      </View>
                      <Text variant="micro" className="w-14 text-right tabular-nums text-text-muted">{l.averageHR != null ? `${Math.round(n(l.averageHR))}` : "—"}</Text>
                      <Text variant="micro" className="w-14 text-right tabular-nums text-text">{l.duration != null ? secMMSS(n(l.duration)) : "—"}</Text>
                    </View>
                    <Text variant="micro" className="pl-8 tabular-nums text-text-muted">
                      {l.distance != null ? `${(n(l.distance) / 1000).toFixed(2)} km` : ""}
                      {l.averageRunCadence != null ? ` · ${Math.round(n(l.averageRunCadence))} spm` : ""}
                      {l.elevationGain != null && l.elevationGain > 0 ? ` · ↑${Math.round(n(l.elevationGain))}m` : ""}
                    </Text>
                  </View>
                );
              })}
              {/* Summary footer (web parity): split count + avg / min / max pace */}
              {laps.length ? (
                <View className="mt-1 gap-1 border-t border-border-subtle pt-2">
                  <View className="flex-row items-center justify-between">
                    <Text variant="micro" className="text-text-muted">{laps.length} splits</Text>
                    <View className="flex-row gap-3">
                      {avgPace ? <Text variant="micro" className="tabular-nums text-text-secondary">{secMMSS(avgPace)}/km avg</Text> : null}
                      {s?.averageHR ? <Text variant="micro" className="tabular-nums text-text-muted">{Math.round(n(s.averageHR))} bpm</Text> : null}
                      {s?.duration ? <Text variant="micro" className="tabular-nums text-text-muted">{hm(s.duration)}</Text> : null}
                    </View>
                  </View>
                  {paceVals.length ? (
                    <View className="flex-row justify-between">
                      <Text variant="micro" className="tabular-nums" style={{ color: "#6ad4a0" }}>fastest {secMMSS(minP)}/km</Text>
                      <Text variant="micro" className="tabular-nums" style={{ color: "#e06060" }}>slowest {secMMSS(maxP)}/km</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
