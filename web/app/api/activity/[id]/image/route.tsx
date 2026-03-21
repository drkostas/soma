import { ImageResponse } from "@vercel/og";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// ── Formatters ────────────────────────────────────────────────────────────────

function formatPace(speedMs: number): string {
  if (!speedMs || speedMs <= 0) return "—";
  const p = 1000 / speedMs / 60;
  return `${Math.floor(p)}:${Math.round((p - Math.floor(p)) * 60).toString().padStart(2, "0")}`;
}
function formatDuration(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return dateStr; }
}
function formatStartTime(dateStr: string): string {
  try {
    const normalized = dateStr.replace(" ", "T");
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return "";
    const h = d.getHours(), m = d.getMinutes().toString().padStart(2, "0");
    return `${h.toString().padStart(2, "0")}:${m}`;
  } catch { return ""; }
}
function formatPaceVal(v: number): string {
  return `${Math.floor(v)}:${Math.round((v - Math.floor(v)) * 60).toString().padStart(2, "0")}`;
}
function getTrainingEffectLabel(te: number): string {
  if (te < 1.0) return "Recovery Run";
  if (te < 2.0) return "Base Run";
  if (te < 3.0) return "Aerobic Run";
  if (te < 3.5) return "Tempo Run";
  if (te < 4.0) return "Threshold Run";
  if (te < 4.5) return "VO2max Run";
  return "Race Effort";
}
function getTrainingEffectColor(te: number): string {
  if (te < 2.0) return "#64748b";
  if (te < 3.0) return "#22c55e";
  if (te < 3.5) return "#3b82f6";
  if (te < 4.0) return "#f59e0b";
  if (te < 4.5) return "#f97316";
  return "#ef4444";
}

// ── Web Mercator ──────────────────────────────────────────────────────────────

function worldX(lng: number, zoom: number) {
  return ((lng + 180) / 360) * Math.pow(2, zoom) * 256;
}
function worldY(lat: number, zoom: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, zoom) * 256;
}
function selectZoom(minLat: number, maxLat: number, minLng: number, maxLng: number, mapW: number, mapH: number) {
  for (let z = 16; z >= 10; z--) {
    const w = worldX(maxLng, z) - worldX(minLng, z);
    const h = worldY(minLat, z) - worldY(maxLat, z);
    if (w <= mapW - 100 && h <= mapH - 100) return z;
  }
  return 12;
}
async function fetchTile(z: number, x: number, y: number): Promise<string | null> {
  try {
    const res = await fetch(`https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch { return null; }
}

// ── Pace color (matches run-map.tsx) ─────────────────────────────────────────

function speedToColor(speed: number | null): string {
  if (!speed || speed <= 0) return "#4b5563";
  const p = 1000 / speed / 60;
  if (p <= 3.5) return "#ff1744";
  if (p <= 5.0) {
    const t = (p - 3.5) / 1.5;
    return `#ff${Math.round(23 + 148 * t).toString(16).padStart(2, "0")}${Math.round(68 * (1 - t)).toString(16).padStart(2, "0")}`;
  }
  if (p <= 7.0) {
    const t = (p - 5.0) / 2.0;
    return `#${Math.round(255 * (1 - t)).toString(16).padStart(2, "0")}${Math.round(171 + 58 * t).toString(16).padStart(2, "0")}${Math.round(255 * t).toString(16).padStart(2, "0")}`;
  }
  return "#00e5ff";
}

// ── Route SVG ─────────────────────────────────────────────────────────────────

function renderRouteSvg(
  pts: { lat: number; lng: number; speed: number | null }[],
  zoom: number, originX: number, originY: number, W: number, H: number
): string {
  const valid = pts.filter((p) => p.lat !== 0 && p.lng !== 0);
  if (valid.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"/>`;
  const step = Math.max(1, Math.floor(valid.length / 600));
  const s = valid.filter((_, i) => i % step === 0);
  const proj = (lat: number, lng: number) => ({ x: worldX(lng, zoom) - originX, y: worldY(lat, zoom) - originY });
  let glow = "", lines = "";
  for (let i = 0; i < s.length - 1; i++) {
    const p1 = proj(s[i].lat, s[i].lng), p2 = proj(s[i + 1].lat, s[i + 1].lng);
    const c = speedToColor(s[i].speed);
    glow  += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${c}" stroke-width="5" stroke-linecap="round" opacity="0.15"/>`;
    lines += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${c}" stroke-width="1.5" stroke-linecap="round" opacity="0.95"/>`;
  }
  const start = proj(s[0].lat, s[0].lng), end = proj(s[s.length - 1].lat, s[s.length - 1].lng);
  const dots = `<circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="4" fill="#22c55e" stroke="#09090b" stroke-width="1.5"/><circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="4" fill="#ef4444" stroke="#09090b" stroke-width="1.5"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${glow}${lines}${dots}</svg>`;
}

// ── Time-series chart SVG with min/max labels ─────────────────────────────────

function renderChartSvg(
  values: (number | null)[],
  color: string, W: number, H: number,
  invertY = false,
  formatLabel?: (v: number) => string,
  totalDistKm?: number,
): string {
  const valid = values.filter((v): v is number => v != null && isFinite(v));
  if (valid.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"/>`;
  const PAD = { t: 18, b: 18, l: 4, r: 4 };
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
  const step = Math.max(1, Math.floor(values.length / 200));
  const sampled = values.filter((_, i) => i % step === 0);
  const nums = sampled.filter((v): v is number => v != null && isFinite(v));
  const minV = Math.min(...nums), maxV = Math.max(...nums), range = maxV - minV || 1;
  const toY = (v: number) => PAD.t + (invertY ? (v - minV) / range : 1 - (v - minV) / range) * cH;
  const pts = sampled.map((v, i) => {
    const x = PAD.l + (i / (sampled.length - 1)) * cW;
    return v != null ? `${x.toFixed(1)},${toY(v).toFixed(1)}` : null;
  }).filter(Boolean);
  if (pts.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"/>`;
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${(PAD.l + cW).toFixed(1)},${(PAD.t + cH).toFixed(1)} L${PAD.l},${(PAD.t + cH).toFixed(1)} Z`;
  const rr = parseInt(color.slice(1, 3), 16), gg = parseInt(color.slice(3, 5), 16), bb = parseInt(color.slice(5, 7), 16);
  const fmt = formatLabel ?? ((v: number) => Math.round(v).toString());
  const topVal = invertY ? minV : maxV;
  const botVal = invertY ? maxV : minV;
  const yLabels = `<text x="${PAD.l + 4}" y="${PAD.t - 4}" font-size="12" fill="#4b5563" font-family="sans-serif">${fmt(topVal)}</text><text x="${PAD.l + 4}" y="${PAD.t + cH + 1}" font-size="12" fill="#4b5563" font-family="sans-serif">${fmt(botVal)}</text>`;
  // X-axis km grid lines (subtle vertical references)
  let xLabels = "";
  if (totalDistKm && totalDistKm > 0) {
    const kmInterval = totalDistKm <= 5 ? 1 : totalDistKm <= 15 ? 2 : 5;
    for (let km = kmInterval; km < totalDistKm; km += kmInterval) {
      const xPos = PAD.l + (km / totalDistKm) * cW;
      xLabels += `<line x1="${xPos.toFixed(1)}" y1="${PAD.t}" x2="${xPos.toFixed(1)}" y2="${PAD.t + cH}" stroke="#1f1f23" stroke-width="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><path d="${area}" fill="rgba(${rr},${gg},${bb},0.18)"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${yLabels}${xLabels}</svg>`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ZONE_COLORS = ["#64748b", "#3b82f6", "#22c55e", "#f97316", "#ef4444"];
const ZONE_LABELS = ["Z1 Warm Up", "Z2 Easy", "Z3 Aerobic", "Z4 Threshold", "Z5 Maximum"];

const IMG_W = 1080;
const IMG_H = 810; // 4:3 landscape
const SIDE = 28;
const LEFT_COL = 500; // map column width
const RIGHT_COL = IMG_W - LEFT_COL - SIDE * 3; // data column
const MAP_W = LEFT_COL;
const MAP_H = 620; // fills most of left column
const CHART_W = Math.floor((RIGHT_COL - 10) / 2);
const CHART_H = 100;

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showBranding = new URL(req.url).searchParams.get("branding") !== "0";
  const sql = getDb();
  const rows = await sql`SELECT endpoint_name, raw_json FROM garmin_activity_raw WHERE activity_id = ${id}`;
  if (!rows.length) return new Response("Not found", { status: 404 });
  const data: Record<string, any> = {};
  for (const r of rows) data[r.endpoint_name] = r.raw_json;

  const summary = data["summary"] ?? {};
  const hrZones: any[] = Array.isArray(data["hr_zones"]) ? data["hr_zones"] : [];

  const title     = summary.activityName || "Run";
  const startTime = summary.startTimeLocal || "";
  const distKm    = summary.distance > 0 ? (summary.distance / 1000).toFixed(2) : null;
  const duration  = summary.duration > 0 ? formatDuration(summary.duration) : null;
  const pace      = summary.averageSpeed > 0 ? formatPace(summary.averageSpeed) : null;
  const avgHr     = summary.averageHR > 0 ? Math.round(summary.averageHR) : null;
  const maxHr     = summary.maxHR > 0 ? Math.round(summary.maxHR) : null;
  const calories  = summary.calories > 0 ? Math.round(summary.calories) : null;
  const elevGain  = summary.elevationGain > 0 ? Math.round(summary.elevationGain) : null;
  const vo2       = summary.vO2MaxValue > 0 ? Number(summary.vO2MaxValue).toFixed(1) : null;
  const teRaw     = summary.aerobicTrainingEffect > 0 ? Number(summary.aerobicTrainingEffect) : null;
  const te        = teRaw != null ? teRaw.toFixed(1) : null;
  const teLabel   = teRaw != null ? getTrainingEffectLabel(teRaw) : null;
  const teColor   = teRaw != null ? getTrainingEffectColor(teRaw) : "#fb923c";
  const cadence   = summary.averageRunningCadenceInStepsPerMinute > 0 ? Math.round(summary.averageRunningCadenceInStepsPerMinute) : null;
  const totalZoneSecs = hrZones.reduce((s, z) => s + (z.secsInZone || 0), 0);

  // Start time for display
  const startTimeFormatted = formatStartTime(startTime);

  // Weather (defensive — may or may not exist)
  let weatherStr: string | null = null;
  const wx = data["weather"] ?? {};
  const tempC = wx.temperature ?? wx.apparentTemperature ?? wx.weatherTemperature ?? null;
  if (tempC != null && isFinite(Number(tempC))) {
    const tempF = Math.round(Number(tempC) * 9 / 5 + 32);
    weatherStr = `${tempF}°F`;
  }

  // Extract GPS + time-series from details
  const details = data["details"];
  const gpsPoints: { lat: number; lng: number; speed: number | null }[] = [];
  const tsPace: (number | null)[] = [], tsHr: (number | null)[] = [];
  const tsElev: (number | null)[] = [], tsCad: (number | null)[] = [];

  if (details?.metricDescriptors && details?.activityDetailMetrics) {
    const desc = details.metricDescriptors as Array<{ key: string; metricsIndex: number }>;
    const mets = details.activityDetailMetrics as Array<{ metrics: number[] }>;
    const ki: Record<string, number> = {};
    for (const d of desc) ki[d.key] = d.metricsIndex;
    const [latI, lngI, spI, hrI, elI, caI] = [
      ki["directLatitude"], ki["directLongitude"], ki["directSpeed"],
      ki["directHeartRate"], ki["directElevation"], ki["directDoubleCadence"],
    ];
    for (const pt of mets) {
      const m = pt.metrics; if (!m) continue;
      const sp = spI != null ? m[spI] ?? null : null;
      const lat = latI != null ? m[latI] ?? null : null;
      const lng = lngI != null ? m[lngI] ?? null : null;
      if (lat && lng && lat !== 0 && lng !== 0) gpsPoints.push({ lat, lng, speed: sp });
      tsPace.push(sp && sp > 0.5 ? 1000 / sp / 60 : null);
      tsHr.push(hrI != null ? m[hrI] ?? null : null);
      tsElev.push(elI != null ? m[elI] ?? null : null);
      const dc = caI != null ? m[caI] ?? null : null;
      tsCad.push(dc != null ? dc / 2 : null);
    }
  }

  // ── Tiles ──
  const tilePlacements: { dataUri: string; left: number; top: number }[] = [];
  let routeSvg = "";

  if (gpsPoints.length >= 2) {
    const lats = gpsPoints.map((p) => p.lat), lngs = gpsPoints.map((p) => p.lng);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const zoom = selectZoom(minLat, maxLat, minLng, maxLng, MAP_W, MAP_H);
    const cx = worldX((minLng + maxLng) / 2, zoom), cy = worldY((minLat + maxLat) / 2, zoom);
    const originX = cx - MAP_W / 2, originY = cy - MAP_H / 2;
    const T = 256;
    const ftx = Math.floor(originX / T), fty = Math.floor(originY / T);
    const ltx = Math.ceil((originX + MAP_W) / T), lty = Math.ceil((originY + MAP_H) / T);
    const coords: { tx: number; ty: number }[] = [];
    for (let ty = fty; ty <= lty && coords.length < 30; ty++)
      for (let tx = ftx; tx <= ltx && coords.length < 30; tx++)
        coords.push({ tx, ty });

    const results = await Promise.all(coords.map(async ({ tx, ty }) => {
      const maxT = Math.pow(2, zoom);
      const uri = await fetchTile(zoom, ((tx % maxT) + maxT) % maxT, ((ty % maxT) + maxT) % maxT);
      return { tx, ty, uri };
    }));
    for (const { tx, ty, uri } of results)
      if (uri) tilePlacements.push({ dataUri: uri, left: tx * T - originX, top: ty * T - originY });

    routeSvg = renderRouteSvg(gpsPoints, zoom, originX, originY, MAP_W, MAP_H);
  }

  // ── Vignette SVG overlay ──
  const vignetteSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}"><defs><radialGradient id="vg" cx="50%" cy="50%" r="72%" gradientUnits="objectBoundingBox"><stop offset="45%" stop-color="#09090b" stop-opacity="0"/><stop offset="100%" stop-color="#09090b" stop-opacity="0.82"/></radialGradient></defs><rect width="${MAP_W}" height="${MAP_H}" fill="url(#vg)"/></svg>`;

  // ── Charts ──
  const distNum = distKm ? parseFloat(distKm) : undefined;
  const paceChart = renderChartSvg(tsPace, "#00e5ff", CHART_W, CHART_H, true,  formatPaceVal, distNum);
  const hrChart   = renderChartSvg(tsHr,   "#f43f5e", CHART_W, CHART_H, false, (v) => Math.round(v).toString(), distNum);
  const elevChart = renderChartSvg(tsElev, "#4ade80", CHART_W, CHART_H, false, (v) => `${Math.round(v)}m`, distNum);
  const cadChart  = renderChartSvg(tsCad,  "#a78bfa", CHART_W, CHART_H, false, (v) => Math.round(v).toString(), distNum);

  // ── Peak values for chart labels ──
  const validPace = tsPace.filter((v): v is number => v != null && isFinite(v) && v > 2 && v < 15);
  const peakPace = validPace.length > 0 ? formatPaceVal(Math.min(...validPace)) : null;
  const validElev = tsElev.filter((v): v is number => v != null && isFinite(v));
  const peakElev = validElev.length > 0 ? Math.round(Math.max(...validElev)) : null;
  const validCad = tsCad.filter((v): v is number => v != null && isFinite(v));
  const peakCad = validCad.length > 0 ? Math.round(Math.max(...validCad) * 2) : null; // tsCad is /2 (per-foot), summary is total spm

  // ── Subtitle parts ──
  const subtitleParts: { text: string; color?: string }[] = [];
  if (startTimeFormatted) subtitleParts.push({ text: startTimeFormatted, color: "#71717a" });
  if (teLabel)             subtitleParts.push({ text: teLabel, color: teColor });
  if (weatherStr)          subtitleParts.push({ text: weatherStr, color: "#71717a" });

  // ── Layout helpers ──
  function MetricCard({ label, val, unit, color }: { label: string; val: string; unit: string; color: string }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", backgroundColor: "#18181b", borderRadius: 10, padding: "8px 12px", flex: 1, gap: 2 }}>
        <div style={{ display: "flex", fontSize: 13, color: "#71717a", textTransform: "uppercase" as const, letterSpacing: 1 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ display: "flex", fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{val}</span>
          <span style={{ display: "flex", fontSize: 14, color: "#52525b" }}>{unit}</span>
        </div>
      </div>
    );
  }

  function ChartCard({ svg, label, avg, peak, color, totalDistKm, avgPrefix = "avg" }: {
    svg: string; label: string; avg: string; peak?: string; color: string; totalDistKm?: number; avgPrefix?: string;
  }) {
    const axisItems: { type: "spacer" | "label"; value: number }[] = [];
    if (totalDistKm && totalDistKm > 0) {
      const kmInt = totalDistKm <= 5 ? 1 : totalDistKm <= 15 ? 2 : 5;
      const kms: number[] = [];
      for (let k = 0; k <= totalDistKm; k += kmInt) kms.push(k);
      for (let i = 0; i < kms.length; i++) {
        if (i > 0) axisItems.push({ type: "spacer", value: Math.round((kms[i] - kms[i - 1]) * 100) });
        axisItems.push({ type: "label", value: kms[i] });
      }
      const remaining = totalDistKm - kms[kms.length - 1];
      if (remaining > 0.3) axisItems.push({ type: "spacer", value: Math.round(remaining * 100) });
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", backgroundColor: "#111113", borderRadius: 10, padding: "8px 10px", gap: 4, width: CHART_W }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ display: "flex", fontSize: 13, color: "#52525b", textTransform: "uppercase" as const, letterSpacing: 1 }}>{label}</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ display: "flex", fontSize: 13, color: "#52525b" }}>{avgPrefix}</span>
            <span style={{ display: "flex", fontSize: 13, fontWeight: 700, color }}>{avg}</span>
            {peak && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ display: "flex", fontSize: 13, color: "#3f3f46" }}>·</span>
                <span style={{ display: "flex", fontSize: 13, color: "#52525b" }}>peak</span>
                <span style={{ display: "flex", fontSize: 13, fontWeight: 700, color }}>{peak}</span>
              </div>
            )}
          </div>
        </div>
        <img width={CHART_W} height={CHART_H} src={`data:image/svg+xml,${encodeURIComponent(svg)}`} style={{ borderRadius: 4, width: "100%" }} />
        {axisItems.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <div style={{ display: "flex", height: 1, backgroundColor: "#27272a" }} />
            <div style={{ display: "flex", alignItems: "center" }}>
              {axisItems.map((item, i) =>
                item.type === "spacer"
                  ? <div key={i} style={{ display: "flex", flexGrow: item.value }} />
                  : <span key={i} style={{ display: "flex", fontSize: 10, color: "#52525b" }}>{item.value}</span>
              )}
              <span style={{ display: "flex", fontSize: 9, color: "#3f3f46", marginLeft: 3 }}>km</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return new ImageResponse(
    (
      <div style={{
        display: "flex", flexDirection: "column",
        width: "100%", height: "100%",
        backgroundColor: "#09090b",
        padding: `${SIDE}px`,
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#fafafa",
        gap: 10,
      }}>

        {/* ── Header (full width) ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#fafafa", lineHeight: 1 }}>{title}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
            <div style={{ display: "flex", fontSize: 16, color: "#a1a1aa" }}>{formatDate(startTime)}</div>
            {duration && <div style={{ display: "flex", fontSize: 14, color: "#52525b" }}>{duration}</div>}
          </div>
        </div>

        {/* ── Subtitle: time · TE · weather ── */}
        {subtitleParts.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {subtitleParts.map((part, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {i > 0 && <span style={{ display: "flex", fontSize: 16, color: "#3f3f46" }}>·</span>}
                <span style={{ display: "flex", fontSize: 16, color: part.color ?? "#71717a", fontWeight: i === 1 && teLabel ? 600 : 400 }}>{part.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Two-column body ── */}
        <div style={{ display: "flex", flex: 1, gap: SIDE }}>

          {/* LEFT: Map */}
          <div style={{
            display: "flex", position: "relative",
            width: LEFT_COL, height: MAP_H, flexShrink: 0,
            backgroundColor: "#0d0d10", borderRadius: 14, overflow: "hidden",
            border: "1px solid #1f1f23",
          }}>
            {tilePlacements.map((t, i) => (
              <img key={i} src={t.dataUri} width={256} height={256}
                style={{ position: "absolute", left: t.left, top: t.top }} />
            ))}
            {routeSvg && (
              <img src={`data:image/svg+xml,${encodeURIComponent(routeSvg)}`}
                width={MAP_W} height={MAP_H}
                style={{ position: "absolute", top: 0, left: 0, width: MAP_W, height: MAP_H }} />
            )}
            <img src={`data:image/svg+xml,${encodeURIComponent(vignetteSvg)}`}
              width={MAP_W} height={MAP_H}
              style={{ position: "absolute", top: 0, left: 0, width: MAP_W, height: MAP_H }} />
            {/* Pace legend */}
            <div style={{
              display: "flex", position: "absolute", bottom: 10, left: 10,
              alignItems: "center", gap: 6,
              backgroundColor: "rgba(9,9,11,0.78)", borderRadius: 8, padding: "4px 10px",
            }}>
              <span style={{ display: "flex", fontSize: 12, color: "#00e5ff", fontWeight: 600 }}>Slow</span>
              <div style={{ display: "flex", width: 48, height: 4, borderRadius: 2, background: "linear-gradient(to right, #00e5ff, #ffab00, #ff1744)" }} />
              <span style={{ display: "flex", fontSize: 12, color: "#ff1744", fontWeight: 600 }}>Fast</span>
            </div>
          </div>

          {/* RIGHT: Data */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-around" }}>

            {/* 4 metrics in a 2×2 grid */}
            <div style={{ display: "flex", gap: 8 }}>
              {distKm && <MetricCard label="Distance" val={distKm} unit="km" color="#22c55e" />}
              {pace && <MetricCard label="Pace" val={pace} unit="/km" color="#00e5ff" />}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {avgHr && <MetricCard label="Avg HR" val={String(avgHr)} unit="bpm" color="#f43f5e" />}
              {calories && <MetricCard label="Calories" val={String(calories)} unit="kcal" color="#f97316" />}
            </div>

            {/* 2×2 charts */}
            <div style={{ display: "flex", gap: 8 }}>
              <ChartCard svg={paceChart} label="Pace" avg={pace ?? "—"} peak={peakPace ?? undefined} color="#00e5ff" totalDistKm={distNum} />
              <ChartCard svg={hrChart} label="HR" avg={avgHr ? `${avgHr}` : "—"} peak={maxHr ? `${maxHr}` : undefined} color="#f43f5e" totalDistKm={distNum} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <ChartCard svg={elevChart} label="Elev" avg={elevGain ? `+${elevGain}m` : "—"} peak={peakElev ? `${peakElev}m` : undefined} color="#4ade80" totalDistKm={distNum} avgPrefix="gain" />
              <ChartCard svg={cadChart} label="Cadence" avg={cadence ? `${cadence}` : "—"} peak={peakCad ? `${peakCad}` : undefined} color="#a78bfa" totalDistKm={distNum} />
            </div>

            {/* HR Zones (compact — only non-zero) */}
            {hrZones.length > 0 && totalZoneSecs > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, backgroundColor: "#111113", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ display: "flex", fontSize: 12, fontWeight: 600, color: "#52525b", letterSpacing: 2, textTransform: "uppercase" as const }}>HR ZONES</div>
                {hrZones.map((z, i) => {
                  const secs = z.secsInZone || 0;
                  if (secs === 0) return null;
                  const pct = (secs / totalZoneSecs) * 100;
                  const m = Math.floor(secs / 60);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ display: "flex", fontSize: 11, color: "#6b7280", width: 72, flexShrink: 0 }}>{ZONE_LABELS[i]}</div>
                      <div style={{ display: "flex", flex: 1, height: 8, backgroundColor: "#1c1c1e", borderRadius: 4 }}>
                        <div style={{ display: "flex", width: `${pct.toFixed(1)}%`, height: "100%", backgroundColor: ZONE_COLORS[i], borderRadius: 4 }} />
                      </div>
                      <div style={{ display: "flex", fontSize: 11, color: "#a1a1aa", width: 26, flexShrink: 0 }}>{m}m</div>
                      <div style={{ display: "flex", fontSize: 11, color: "#52525b", width: 26, flexShrink: 0 }}>{pct.toFixed(0)}%</div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>

        {/* ── Footer ── */}
        {showBranding && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1c1c1e", paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", width: 20, height: 3, backgroundColor: "#10b981", borderRadius: 2 }} />
              <span style={{ display: "flex", fontSize: 16, fontWeight: 800, color: "#10b981", letterSpacing: 4 }}>SOMA</span>
            </div>
            <div style={{ display: "flex", fontSize: 13, color: "#3f3f46" }}>github.com/drkostas/soma</div>
          </div>
        )}
      </div>
    ),
    { width: IMG_W, height: IMG_H }
  );
}
