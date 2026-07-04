import { ImageResponse } from "@vercel/og";
import sharp from "sharp";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// #rrggbb -> [r,g,b]
function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexToRgba(h: string, a: number): string {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r},${g},${b},${a})`;
}

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
// Minimum enclosing circle (Ritter's approximation) of points in zoom-0 world px.
// Used to frame the route consistently regardless of its shape (no aspect-ratio bias).
function boundingCircle(pts: { x: number; y: number }[]) {
  const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  let p1 = pts.reduce((a, b) => (d2(pts[0], b) > d2(pts[0], a) ? b : a), pts[0]);
  let p2 = pts.reduce((a, b) => (d2(p1, b) > d2(p1, a) ? b : a), pts[0]);
  let cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
  let r = Math.sqrt(d2(p1, p2)) / 2;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > r) {
      const k = (d - r) / (2 * d);
      cx += (p.x - cx) * k; cy += (p.y - cy) * k;
      r = (r + d) / 2;
    }
  }
  return { cx, cy, r };
}
// Basemap tile sources (several have a real blue sea). {z}/{x}/{y} placeholders;
// Esri uses {z}/{y}/{x} order, handled by the template string itself.
const BASEMAPS: Record<string, string> = {
  dark:        "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  darknolabels:"https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
  voyager:     "https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",
  positron:    "https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
  ocean:       "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
  satellite:   "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  darkgray:    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  lightgray:   "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  natgeo:      "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
  terrain:     "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
  osm:         "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};

async function fetchTile(
  tpl: string, z: number, x: number, y: number,
  opts?: { duo?: { lo: [number, number, number]; hi: [number, number, number] }; bright?: number; sat?: number; hue?: number; sea?: [number, number, number]; seaDeep?: [number, number, number] },
): Promise<string | null> {
  try {
    const url = tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    // Retry once so a transient tile miss doesn't leave a black gap in the map.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": "soma-activity-image" }, signal: AbortSignal.timeout(6500) });
        if (r.ok) res = r;
      } catch { /* retry */ }
    }
    if (!res) return null;
    const ct = res.headers.get("content-type") || "image/png";
    let buf = Buffer.from(await res.arrayBuffer());
    const duo = opts?.duo, bright = opts?.bright, sat = opts?.sat, hue = opts?.hue, sea = opts?.sea;
    const mod = (bright && bright !== 1) || (sat && sat !== 1) || (hue && hue !== 0);
    if (duo || mod || sea) {
      let img = sharp(buf);
      if (mod) img = img.modulate({ brightness: bright ?? 1, saturation: sat ?? 1, hue: hue ?? 0 });
      if (duo) {
        const mult = [0, 1, 2].map((i) => (duo.hi[i] - duo.lo[i]) / 255);
        img = img.grayscale().toColourspace("srgb").linear(mult, duo.lo);
      }
      buf = await img.png().toBuffer();
      if (sea) buf = await recolorSea(buf, sea, opts?.seaDeep);
      return `data:image/png;base64,${buf.toString("base64")}`;
    }
    // Emit with the real mime (Esri returns JPEG; a wrong png mime renders blank).
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

// Repaint the sea (bluish pixels) to a target color, keeping land untouched.
// Voyager's water is the region where blue is clearly the dominant channel.
async function recolorSea(
  buf: Buffer, shallow: [number, number, number], deep?: [number, number, number],
): Promise<Buffer> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (b > r + 6 && b >= g - 4) {
      const lum = (0.35 * r + 0.5 * g + 0.15 * b) / 255;
      if (deep) {
        // Tropical gradient: bright shallow (light water) → deep blue (dark water).
        const t = Math.max(0, Math.min(1, (lum - 0.5) / 0.4));
        data[i]     = Math.round(deep[0] + (shallow[0] - deep[0]) * t);
        data[i + 1] = Math.round(deep[1] + (shallow[1] - deep[1]) * t);
        data[i + 2] = Math.round(deep[2] + (shallow[2] - deep[2]) * t);
      } else {
        const f = 0.55 + 0.55 * lum;
        data[i] = Math.min(255, Math.round(shallow[0] * f));
        data[i + 1] = Math.min(255, Math.round(shallow[1] * f));
        data[i + 2] = Math.min(255, Math.round(shallow[2] * f));
      }
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
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

// ── Kiteboarding speed color (water/spray: deep ocean → cyan → foam) ─────────
// speed is m/s; kiteboarding ranges roughly 0–30+ km/h.

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0"));
  return `#${c.join("")}`;
}
// Kite route speed palettes (color stops mapped across ~4–32 km/h). On a teal/
// tropical sea the cool (blue/cyan) end blends in, so warm palettes read better.
const KITE_PALETTES: Record<string, string[]> = {
  cool:     ["#2563eb", "#06b6d4", "#f59e0b", "#ff1744"], // original (cyan blends on teal)
  heat:     ["#fef3c7", "#fb923c", "#ef4444", "#7f1d1d"], // cream → orange → red → dark
  magenta:  ["#fbcfe8", "#e879f9", "#f43f5e", "#9f1239"], // pink → magenta → rose → crimson
  coral:    ["#fed7aa", "#fb7185", "#e11d48", "#4c0519"], // peach → coral → rose → dark
  fire:     ["#fde047", "#f97316", "#dc2626", "#450a0a"], // yellow → orange → red → near-black
  // Cold→hot with a PURE blue slow end (distinct from the teal sea, no cyan/green):
  spectral: ["#1d4ed8", "#a855f7", "#f59e0b", "#ef4444"], // blue → purple → amber → red
  coolwarm: ["#2563eb", "#e2e8f0", "#fb923c", "#dc2626"], // blue → white → orange → red
  jet:      ["#1d4ed8", "#7c3aed", "#f472b6", "#f59e0b", "#dc2626"], // blue→violet→pink→amber→red
};
// t is already normalised 0..1 (a speed rank); map it across the palette stops.
function kiteRouteColor(t: number, stops: string[]): string {
  const tt = Math.max(0, Math.min(0.9999, t));
  const n = stops.length - 1;
  const seg = Math.floor(tt * n);
  return lerpHex(stops[seg], stops[seg + 1], tt * n - seg);
}

// The top jump's REAL flight in 3D, framed from a viewpoint FITTED to the user's
// own hand-picks (jump-viewer tool). Statistical analysis of 9 framings found the
// invariant is a specific geometry, not "camera behind takeoff": takeoff (green)
// nearest the viewer, the approach line showing ~0.69 of its true length, the
// landing line ~0.51, a low ~16° camera, and a tall arc. We search azimuth ×
// elevation on the upper hemisphere (camera always above the water) and pick the
// view best matching those targets — reproducing how the user frames jumps.
function renderJumpArcSvg(
  W: number, H: number, traj: number[], airtimeS: number,
  path: [number, number, number][],
  windFromDeg?: number | null,
  azBiasDeg = 0,
): string {
  const t0p = path.reduce((a, b) => (Math.abs(b[0]) < Math.abs(a[0]) ? b : a), path[0]);
  const lat0 = t0p[1], lng0 = t0p[2];
  const mPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180), mPerLat = 110540;
  const horiz = path.map(([t, la, lg]) => ({ t, x: (lg - lng0) * mPerLng, y: (la - lat0) * mPerLat }));
  const Z_EXAG = 1.9;
  const hAt = (t: number) => {
    if (t < 0 || t > airtimeS || traj.length < 2) return 0;
    const f = (t / airtimeS) * (traj.length - 1), i = Math.min(traj.length - 2, Math.floor(f));
    return traj[i] + (traj[i + 1] - traj[i]) * (f - i);
  };
  const xyAt = (t: number) => {
    if (t <= horiz[0].t) return horiz[0];
    for (let i = 0; i < horiz.length - 1; i++) {
      if (t <= horiz[i + 1].t) {
        const f = (t - horiz[i].t) / Math.max(0.001, horiz[i + 1].t - horiz[i].t);
        return { x: horiz[i].x + (horiz[i + 1].x - horiz[i].x) * f, y: horiz[i].y + (horiz[i + 1].y - horiz[i].y) * f };
      }
    }
    return horiz[horiz.length - 1];
  };
  const tMin = Math.max(horiz[0].t, -1.2), tMax = Math.min(horiz[horiz.length - 1].t, airtimeS + 1.5);
  const samples: { t: number; x: number; y: number; z: number; w: number[] }[] = [];
  for (let t = tMin; t <= tMax + 1e-6; t += 0.25) { const p = xyAt(t); samples.push({ t, x: p.x, y: p.y, z: hAt(t) * Z_EXAG, w: [0, 0, 0] }); }
  const cx = samples.reduce((a, p) => a + p.x, 0) / samples.length;
  const cy = samples.reduce((a, p) => a + p.y, 0) / samples.length;
  samples.forEach((p) => { p.w = [p.x - cx, p.y - cy, p.z]; });
  const peakZ = Math.max(...samples.map((p) => p.z), 0.01);
  const iT = Math.max(0, samples.findIndex((p) => p.t >= 0));
  let iL = samples.findIndex((p) => p.t >= airtimeS); if (iL < 0) iL = samples.length - 1;
  const iP = samples.reduce((a, p, i) => (p.z > samples[a].z ? i : a), 0);
  const tgt = [0, 0, peakZ / 3];

  const nrm = (v: number[]) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  type Basis = { camDir: number[]; right: number[]; up: number[] };
  const basis = (A: number, E: number): Basis => {
    const camDir = [Math.cos(E) * Math.sin(A), Math.cos(E) * Math.cos(A), Math.sin(E)];
    const f = [-camDir[0], -camDir[1], -camDir[2]];
    const right = nrm(cross(f, [0, 0, 1]));
    return { camDir, right, up: cross(right, f) };
  };
  const pW = (w: number[], b: Basis) => { const d = [w[0] - tgt[0], w[1] - tgt[1], w[2] - tgt[2]]; return { sx: dot(d, b.right), sy: dot(d, b.up), depth: dot(d, b.camDir) }; };
  const len2 = (ps: { sx: number; sy: number }[]) => { let s = 0; for (let i = 1; i < ps.length; i++) s += Math.hypot(ps[i].sx - ps[i - 1].sx, ps[i].sy - ps[i - 1].sy); return s; };
  const len3 = (ws: number[][]) => { let s = 0; for (let i = 1; i < ws.length; i++) s += Math.hypot(ws[i][0] - ws[i - 1][0], ws[i][1] - ws[i - 1][1], ws[i][2] - ws[i - 1][2]); return s; };

  // viewpoint search: match the user's measured framing invariants
  const appW = samples.slice(0, iT + 1).map((p) => p.w);
  const runW = samples.slice(iL).map((p) => p.w);
  const trueA = Math.max(1e-6, len3(appW)), trueR = Math.max(1e-6, len3(runW));
  let best: { A: number; E: number; score: number } | null = null;
  for (let Ad = 0; Ad < 360; Ad += 6) {
    const A = (Ad * Math.PI) / 180;
    for (let Ed = 10; Ed <= 26; Ed += 2) {
      const b = basis(A, (Ed * Math.PI) / 180);
      const gd = pW(samples[iT].w, b).depth, rd = pW(samples[iL].w, b).depth;
      if (gd <= rd) continue;                                   // green (takeoff) must be nearest
      const visT = len2(appW.map((w) => pW(w, b))) / trueA;
      const visL = len2(runW.map((w) => pW(w, b))) / trueR;
      if (visT < 0.25 || visL < 0.12) continue;                 // avoid end-on degeneracy
      const pk = pW(samples[iP].w, b), tk = pW(samples[iT].w, b), ld = pW(samples[iL].w, b);
      const fw = Math.hypot(ld.sx - tk.sx, ld.sy - tk.sy) || 1;
      const peakRise = (pk.sy - (tk.sy + ld.sy) / 2) / fw;
      const score = -2.4 * (visT - 0.69) ** 2 - 0.7 * (visL - 0.51) ** 2 - 0.01 * (Ed - 16) ** 2 + 0.08 * Math.min(peakRise, 1.4);
      if (!best || score > best.score) best = { A, E: (Ed * Math.PI) / 180, score };
    }
  }
  if (!best) best = { A: 0, E: (16 * Math.PI) / 180, score: 0 };
  const B = basis(best.A + (azBiasDeg * Math.PI) / 180, best.E);
  const proj = (w: number[]) => { const p = pW(w, B); return { px: p.sx, py: -p.sy }; };

  const flight = samples.map((p) => proj(p.w));
  const ground = samples.map((p) => proj([p.w[0], p.w[1], 0]));
  // grid aligned to the flight direction (always projects obliquely, reads as a plane)
  const fd = nrm([samples[iL].w[0] - samples[iT].w[0], samples[iL].w[1] - samples[iT].w[1], 0]);
  const pd = [-fd[1], fd[0], 0];
  const af = samples.map((p) => p.w[0] * fd[0] + p.w[1] * fd[1]);
  const ap = samples.map((p) => p.w[0] * pd[0] + p.w[1] * pd[1]);
  const GRID = 5, gp = 4;
  const f0 = Math.floor((Math.min(...af) - gp) / GRID) * GRID, f1 = Math.ceil((Math.max(...af) + gp) / GRID) * GRID;
  const p0 = Math.floor((Math.min(...ap) - gp) / GRID) * GRID, p1 = Math.ceil((Math.max(...ap) + gp) / GRID) * GRID;
  const gw = (a: number, c: number) => [a * fd[0] + c * pd[0], a * fd[1] + c * pd[1], 0];
  const gridPts: { px: number; py: number }[] = [];
  for (let a = f0; a <= f1; a += GRID) gridPts.push(proj(gw(a, p0)), proj(gw(a, p1)));
  for (let c = p0; c <= p1; c += GRID) gridPts.push(proj(gw(f0, c)), proj(gw(f1, c)));
  const seaCorners = [gw(f0, p0), gw(f1, p0), gw(f1, p1), gw(f0, p1)].map(proj);

  const all = [...flight, ...ground, ...gridPts];
  const minX = Math.min(...all.map((p) => p.px)), maxX = Math.max(...all.map((p) => p.px));
  const minY = Math.min(...all.map((p) => p.py)), maxY = Math.max(...all.map((p) => p.py));
  const pad = { l: 6, r: 6, t: 12, b: 6 };
  const sc = Math.min((W - pad.l - pad.r) / Math.max(1e-6, maxX - minX), (H - pad.t - pad.b) / Math.max(1e-6, maxY - minY));
  const fit = (p: { px: number; py: number }) => ({
    x: pad.l + (p.px - minX) * sc + (W - pad.l - pad.r - (maxX - minX) * sc) / 2,
    y: pad.t + (p.py - minY) * sc + (H - pad.t - pad.b - (maxY - minY) * sc) / 2,
  });
  const F = flight.map(fit), G = ground.map(fit), SC = seaCorners.map(fit);
  const toPath = (pts: { x: number; y: number }[]) => `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}`;
  let grid = "";
  for (let i = 0; i < gridPts.length; i += 2) {
    const a = fit(gridPts[i]), b = fit(gridPts[i + 1]);
    grid += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#ffffff" stroke-opacity="0.2" stroke-width="0.8"/>`;
  }
  let drops = "";
  samples.forEach((p, i) => {
    if (p.z > 0.3 && Math.abs((p.t * 4) % 4) < 0.5)
      drops += `<line x1="${F[i].x.toFixed(1)}" y1="${F[i].y.toFixed(1)}" x2="${G[i].x.toFixed(1)}" y2="${G[i].y.toFixed(1)}" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1" stroke-dasharray="2,2"/>`;
  });
  const peakZs = Math.max(...samples.map((p) => p.z), 0.01);
  const zColor = (z: number) => { const t = Math.max(0, Math.min(1, z / peakZs)); return t < 0.5 ? lerpHex("#38bdf8", "#f59e0b", t * 2) : lerpHex("#f59e0b", "#fff5e6", (t - 0.5) * 2); };
  let flightSegs = "";
  for (let i = iT; i < iL; i++)
    flightSegs += `<line x1="${F[i].x.toFixed(1)}" y1="${F[i].y.toFixed(1)}" x2="${F[i + 1].x.toFixed(1)}" y2="${F[i + 1].y.toFixed(1)}" stroke="${zColor((samples[i].z + samples[i + 1].z) / 2)}" stroke-width="3" stroke-linecap="round"/>`;
  const gFlight = G.slice(iT, iL + 1);
  const approach = F.slice(0, iT + 1), runout = F.slice(iL);
  let wind = "";
  if (windFromDeg != null && isFinite(windFromDeg)) {
    const bw = ((windFromDeg + 180) * Math.PI) / 180;
    const o = proj([0, 0, 0]), wt = proj([Math.sin(bw), Math.cos(bw), 0]);
    const wl = Math.hypot(wt.px - o.px, wt.py - o.py) || 1;
    const ux = (wt.px - o.px) / wl, uy = (wt.py - o.py) / wl;
    const cxw = 18, cyw = H - 12, L = 13, x2 = cxw + ux * L, y2 = cyw + uy * L, hx = -ux, hy = -uy;
    wind = `<g opacity="0.55"><line x1="${(cxw - ux * L * 0.4).toFixed(1)}" y1="${(cyw - uy * L * 0.4).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e0f2fe" stroke-width="1.6" stroke-linecap="round"/><path d="M${x2.toFixed(1)},${y2.toFixed(1)} L${(x2 + hx * 4 - uy * 2.6).toFixed(1)},${(y2 + hy * 4 + ux * 2.6).toFixed(1)} L${(x2 + hx * 4 + uy * 2.6).toFixed(1)},${(y2 + hy * 4 - ux * 2.6).toFixed(1)} Z" fill="#e0f2fe"/><text x="${(cxw + 10).toFixed(1)}" y="${(cyw + 3.5).toFixed(1)}" font-size="8.5" fill="#bae6fd" font-family="sans-serif">wind</text></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#334155" stop-opacity="0.35"/><stop offset="70%" stop-color="#334155" stop-opacity="0"/></linearGradient>
      <linearGradient id="seafill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2DD4BF" stop-opacity="0.5"/><stop offset="100%" stop-color="#0E7490" stop-opacity="0.72"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#sky)"/>
    <path d="${toPath(SC)} Z" fill="url(#seafill)"/>
    ${grid}
    ${wind}
    <path d="${toPath(G)}" fill="none" stroke="#0a0a0a" stroke-opacity="0.35" stroke-width="2" stroke-linecap="round"/>
    <path d="${toPath(gFlight)}" fill="none" stroke="#0a0a0a" stroke-opacity="0.55" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3,3"/>
    ${drops}
    <path d="${toPath(approach)}" fill="none" stroke="#7dd3fc" stroke-opacity="0.9" stroke-width="2.5" stroke-linecap="round"/>
    <path d="${toPath(runout)}" fill="none" stroke="#7dd3fc" stroke-opacity="0.9" stroke-width="2.5" stroke-linecap="round"/>
    ${flightSegs}
    <circle cx="${F[iT].x.toFixed(1)}" cy="${F[iT].y.toFixed(1)}" r="3.2" fill="#22c55e"/>
    <circle cx="${F[iL].x.toFixed(1)}" cy="${F[iL].y.toFixed(1)}" r="3.2" fill="#ef4444"/>
    <circle cx="${F[iP].x.toFixed(1)}" cy="${F[iP].y.toFixed(1)}" r="4" fill="#ffffff"/>
  </svg>`;
}

// ── Route SVG ─────────────────────────────────────────────────────────────────

function renderRouteSvg(
  pts: { lat: number; lng: number; speed: number | null }[],
  zoom: number, cx: number, cy: number, scale: number, W: number, H: number,
  colorFn: (s: number | null) => string = speedToColor,
  lineOpacity = 0.95,
  lineWidth = 1.5
): string {
  const valid = pts.filter((p) => p.lat !== 0 && p.lng !== 0);
  if (valid.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"/>`;
  const step = Math.max(1, Math.floor(valid.length / 600));
  const s = valid.filter((_, i) => i % step === 0);
  const proj = (lat: number, lng: number) => ({ x: W / 2 + (worldX(lng, zoom) - cx) * scale, y: H / 2 + (worldY(lat, zoom) - cy) * scale });
  let glow = "", lines = "";
  for (let i = 0; i < s.length - 1; i++) {
    const p1 = proj(s[i].lat, s[i].lng), p2 = proj(s[i + 1].lat, s[i + 1].lng);
    const c = colorFn(s[i].speed);
    glow  += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${c}" stroke-width="${(lineWidth * 3.3).toFixed(1)}" stroke-linecap="round" opacity="0.15"/>`;
    lines += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${c}" stroke-width="${lineWidth}" stroke-linecap="round" opacity="${lineOpacity}"/>`;
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
  const q = new URL(req.url).searchParams;
  const showBranding = q.get("branding") !== "0";
  const duo = (q.get("wcol") && q.get("lcol"))
    ? { lo: hexToRgb(q.get("wcol")!), hi: hexToRgb(q.get("lcol")!) } : undefined;
  const sql = getDb();
  const rows = await sql`SELECT endpoint_name, raw_json FROM garmin_activity_raw WHERE activity_id = ${id}`;
  if (!rows.length) return new Response("Not found", { status: 404 });
  const data: Record<string, any> = {};
  for (const r of rows) data[r.endpoint_name] = r.raw_json;

  const summary = data["summary"] ?? {};
  const hrZones: any[] = Array.isArray(data["hr_zones"]) ? data["hr_zones"] : [];

  const typeKey   = (summary.activityType?.typeKey || "").toLowerCase();
  const isKite    = typeKey.includes("kite");
  const routePal = q.get("routepal") || "spectral";

  // Visual knobs: query params override; otherwise kite uses its tuned defaults
  // (voyager vivid map, tight zoom, thin faded route, gold proportional dots).
  const tpl = BASEMAPS[q.get("basemap") || (isKite ? "voyager" : "dark")] || BASEMAPS.dark;
  const sat = q.get("sat") ? parseFloat(q.get("sat")!) : (isKite ? 1.3 : undefined);
  const bright = q.get("bdim") ? parseFloat(q.get("bdim")!) : undefined;
  const hue = q.get("hue") ? parseFloat(q.get("hue")!) : undefined;
  const sea = q.get("sea") ? hexToRgb(q.get("sea")!) : (isKite ? hexToRgb("2DD4BF") : undefined);
  const seaDeep = q.get("sead") ? hexToRgb(q.get("sead")!) : (isKite ? hexToRgb("0E7490") : undefined);
  const zoomAdj = q.get("zoomadj") != null ? (parseFloat(q.get("zoomadj")!) || 0) : 0;
  const lineWQ = q.get("linew") ? parseFloat(q.get("linew")!) : (isKite ? 1 : null);
  const lineOpQ = q.get("lineop") ? parseFloat(q.get("lineop")!) : (isKite ? 0.8 : null);
  const dotSzQ = q.get("dotsz") ? parseInt(q.get("dotsz")!, 10) : null;
  const dotColQ = q.get("dotcol") ? `#${q.get("dotcol")!.replace("#", "")}` : null;
  const dotOpQ = q.get("dotop") ? parseFloat(q.get("dotop")!) : null;

  let title       = summary.activityName || (isKite ? "Kiteboarding" : "Run");
  const startTime = summary.startTimeLocal || "";
  const distKm    = summary.distance > 0 ? (summary.distance / 1000).toFixed(2) : null;
  const duration  = summary.duration > 0 ? formatDuration(summary.duration) : null;
  const movingDur = summary.movingDuration > 0 ? formatDuration(summary.movingDuration) : null;
  const pace      = summary.averageSpeed > 0 ? formatPace(summary.averageSpeed) : null;
  const maxSpeedKmh = summary.maxSpeed > 0 ? (summary.maxSpeed * 3.6).toFixed(1) : null;
  const avgSpeedKmh = summary.averageSpeed > 0 ? (summary.averageSpeed * 3.6).toFixed(1) : null;
  // Kiteboarding speeds are shown in knots (project preference).
  const maxSpeedKn = summary.maxSpeed > 0 ? (summary.maxSpeed * 1.94384).toFixed(1) : null;
  const avgSpeedKn = summary.averageSpeed > 0 ? (summary.averageSpeed * 1.94384).toFixed(1) : null;
  // Per-jump data (height + GPS position) extracted from the FIT into garmin_activity_raw.
  const kiteData = data["kite_jumps"] ?? {};
  const jumps: any[] = Array.isArray(kiteData.jumps) ? kiteData.jumps : [];
  const jumpSummary = kiteData.summary ?? {};
  const maxJumpM = jumpSummary.max_height_m != null ? Number(jumpSummary.max_height_m).toFixed(1) : null;
  const jumpCount = jumpSummary.jump_count ?? jumps.length;
  const maxAirtime = jumpSummary.max_airtime_s != null ? Number(jumpSummary.max_airtime_s).toFixed(1) : null;
  const kiteSpot = jumpSummary.spot
    || (summary.activityName || "")
        .replace(/session at spot:?/i, "")
        .replace(/kiteboarding|kitesurfing|kitesurf|kiteboard/gi, "")
        .replace(/surfr\.?/i, "")
        .replace(/['".]/g, "")
        .trim()
    || summary.locationName || "Kite";
  if (isKite) {
    title = maxJumpM
      ? `${kiteSpot} · Max Jump: ${maxJumpM}m · ${jumpCount} jumps`
      : `${kiteSpot} Kiteboarding`;
  }
  // Jump dots: biggest jump = max size, the rest scaled proportionally by height.
  const maxJumpNum = jumpSummary.max_height_m
    ? Number(jumpSummary.max_height_m)
    : (jumps.length ? Math.max(...jumps.map((j: any) => j.height_m)) : 1);
  const maxDot = dotSzQ ?? 20;
  const dotCol = dotColQ ?? "#0a0a0a";                                  // black-transparent bullseye
  const dotAlpha = dotOpQ != null ? dotOpQ : (isKite ? 0.55 : 1);       // translucent fill
  const dotOutline = q.get("dotout") ? parseFloat(q.get("dotout")!) : (isKite ? 1 : 0); // ring, EXTRA on top
  const showArc = q.get("arc") !== "0";
  const topJump = jumps.length ? jumps[0] : null;
  // Only render when we have the REAL flight: measured heights + the GPS window.
  const hasTraj = !!(topJump?.trajectory_m?.length >= 3 && topJump?.airtime_s > 0 && topJump?.path?.length >= 3);
  const arcSvg = hasTraj ? renderJumpArcSvg(184, 118, topJump.trajectory_m, topJump.airtime_s, topJump.path, Number((data["weather"] ?? {}).windDirection), q.get("arcrot") ? parseFloat(q.get("arcrot")!) : 0) : "";
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
  const tsSpeed: (number | null)[] = []; // km/h, for kiteboarding and watercraft

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
      tsSpeed.push(sp && sp > 0 ? sp * 3.6 : null);
      tsHr.push(hrI != null ? m[hrI] ?? null : null);
      tsElev.push(elI != null ? m[elI] ?? null : null);
      const dc = caI != null ? m[caI] ?? null : null;
      tsCad.push(dc != null ? dc / 2 : null);
    }
  }

  // Speed→color scaled to THIS session's speed distribution (kite planes fast, so a
  // fixed low anchor makes the whole track read as fast). Percentiles give a real spread.
  const speedsKmh = gpsPoints.map((p) => p.speed).filter((s): s is number => !!s && s > 0).map((s) => s * 3.6).sort((a, b) => a - b);
  // Rank (percentile) of a speed within the session — histogram equalization so the
  // clustered planing speeds still spread across the whole palette.
  const rankOf = (kmh: number) => {
    if (speedsKmh.length < 2) return 0.5;
    let lo = 0, hi = speedsKmh.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (speedsKmh[mid] < kmh) lo = mid + 1; else hi = mid; }
    return lo / (speedsKmh.length - 1);
  };
  // Distribution: the bulk of the route splits ~50/50 slow↔medium (blue→amber), and
  // only the top `redPct` of speeds get pushed into the final red — so just a few
  // segments read fast, exactly as intended.
  const redPct = q.get("redpct") ? parseFloat(q.get("redpct")!) : 0.04;
  const kiteStops = KITE_PALETTES[routePal] || KITE_PALETTES.spectral;
  const topStart = (kiteStops.length - 2) / (kiteStops.length - 1); // t where the last color starts
  const rankToT = (rank: number) => (rank <= 1 - redPct
    ? (rank / (1 - redPct)) * topStart
    : topStart + ((rank - (1 - redPct)) / redPct) * (1 - topStart));
  const routeColorFn = isKite
    ? (s: number | null) => kiteRouteColor(s && s > 0 ? rankToT(rankOf(s * 3.6)) : 0, kiteStops)
    : speedToColor;

  // ── Tiles ──
  const tilePlacements: { dataUri: string; left: number; top: number; size: number }[] = [];
  let routeSvg = "";
  const jumpMarkers: { x: number; y: number; height_m: number; rank: number; airtime_s?: number }[] = [];

  if (gpsPoints.length >= 2) {
    // Framing: kite uses the route's minimum enclosing CIRCLE (consistent across
    // route shapes, matches the round vignette); runs keep the bounding-box fit.
    // Everything is computed in zoom-0 world px then scaled to the tile zoom.
    let fitZoom: number, cx0: number, cy0: number;
    if (isKite) {
      const w0 = gpsPoints.map((p) => ({ x: worldX(p.lng, 0), y: worldY(p.lat, 0) }));
      const circ = boundingCircle(w0);
      // When the top-jump card is shown, reserve headroom: the route circle fits
      // into the area BELOW the card so the overlay never touches the lines.
      const reserveTop = showArc && hasTraj ? 195 : 0;
      const TARGET = Math.round((MAP_H - reserveTop) * 0.71); // 440 at full height
      fitZoom = Math.log2(TARGET / (2 * Math.max(circ.r, 1e-9))) + zoomAdj;
      cx0 = circ.cx; cy0 = circ.cy;
      // Shift the view centre up in zoom-0 world px so the route sits centred in
      // the lower band (screen px → zoom-0 world px via the FRACTIONAL fitZoom).
      cy0 -= (reserveTop / 2) / Math.pow(2, fitZoom);
    } else {
      const lats = gpsPoints.map((p) => p.lat), lngs = gpsPoints.map((p) => p.lng);
      const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
      fitZoom = selectZoom(minLat, maxLat, minLng, maxLng, MAP_W, MAP_H) + zoomAdj;
      cx0 = worldX((minLng + maxLng) / 2, 0); cy0 = worldY((minLat + maxLat) / 2, 0);
    }
    const zoom = Math.max(10, Math.min(18, Math.round(fitZoom)));
    const scale = Math.pow(2, fitZoom - zoom); // residual scale (~0.7..1.4), keeps tiles sharp
    const cx = cx0 * Math.pow(2, zoom), cy = cy0 * Math.pow(2, zoom);
    const T = 256, tSize = T * scale;
    const project = (lat: number, lng: number) => ({
      x: MAP_W / 2 + (worldX(lng, zoom) - cx) * scale,
      y: MAP_H / 2 + (worldY(lat, zoom) - cy) * scale,
    });
    for (const j of jumps) {
      if (j.lat == null || j.lng == null) continue;
      const p = project(j.lat, j.lng);
      if (p.x >= 6 && p.x <= MAP_W - 6 && p.y >= 6 && p.y <= MAP_H - 6)
        jumpMarkers.push({ x: p.x, y: p.y, height_m: j.height_m, rank: j.rank, airtime_s: j.airtime_s });
    }
    const halfW = MAP_W / (2 * scale), halfH = MAP_H / (2 * scale);
    const ftx = Math.floor((cx - halfW) / T), fty = Math.floor((cy - halfH) / T);
    const ltx = Math.ceil((cx + halfW) / T), lty = Math.ceil((cy + halfH) / T);
    const coords: { tx: number; ty: number }[] = [];
    for (let ty = fty; ty <= lty && coords.length < 42; ty++)
      for (let tx = ftx; tx <= ltx && coords.length < 42; tx++)
        coords.push({ tx, ty });

    const results = await Promise.all(coords.map(async ({ tx, ty }) => {
      const maxT = Math.pow(2, zoom);
      const uri = await fetchTile(tpl, zoom, ((tx % maxT) + maxT) % maxT, ((ty % maxT) + maxT) % maxT, { duo, bright, sat, hue, sea, seaDeep });
      return { tx, ty, uri };
    }));
    for (const { tx, ty, uri } of results)
      if (uri) tilePlacements.push({ dataUri: uri, left: MAP_W / 2 + (tx * T - cx) * scale, top: MAP_H / 2 + (ty * T - cy) * scale, size: tSize });

    routeSvg = renderRouteSvg(gpsPoints, zoom, cx, cy, scale, MAP_W, MAP_H, routeColorFn, lineOpQ ?? (isKite ? 0.72 : 0.95), lineWQ ?? 1.5);
  }

  // ── Vignette SVG overlay ──
  const vignetteSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}"><defs><radialGradient id="vg" cx="50%" cy="50%" r="72%" gradientUnits="objectBoundingBox"><stop offset="45%" stop-color="#09090b" stop-opacity="0"/><stop offset="100%" stop-color="#09090b" stop-opacity="0.82"/></radialGradient></defs><rect width="${MAP_W}" height="${MAP_H}" fill="url(#vg)"/></svg>`;

  // ── Charts ──
  const distNum = distKm ? parseFloat(distKm) : undefined;
  const paceChart = renderChartSvg(tsPace, "#00e5ff", CHART_W, CHART_H, true,  formatPaceVal, distNum);
  const hrChart   = renderChartSvg(tsHr,   "#f43f5e", CHART_W, CHART_H, false, (v) => Math.round(v).toString(), distNum);
  const elevChart = renderChartSvg(tsElev, "#4ade80", CHART_W, CHART_H, false, (v) => `${Math.round(v)}m`, distNum);
  const cadChart  = renderChartSvg(tsCad,  "#a78bfa", CHART_W, CHART_H, false, (v) => Math.round(v).toString(), distNum);
  const speedChart = renderChartSvg(tsSpeed, "#22d3ee", CHART_W, CHART_H, false, (v) => `${Math.round(v)}`, distNum);

  // ── Peak values for chart labels ──
  const validPace = tsPace.filter((v): v is number => v != null && isFinite(v) && v > 2 && v < 15);
  const peakPace = validPace.length > 0 ? formatPaceVal(Math.min(...validPace)) : null;
  const validElev = tsElev.filter((v): v is number => v != null && isFinite(v));
  const peakElev = validElev.length > 0 ? Math.round(Math.max(...validElev)) : null;
  const validCad = tsCad.filter((v): v is number => v != null && isFinite(v));
  const peakCad = validCad.length > 0 ? Math.round(Math.max(...validCad) * 2) : null; // tsCad is /2 (per-foot), summary is total spm
  const validSpeed = tsSpeed.filter((v): v is number => v != null && isFinite(v));
  const peakSpeed = validSpeed.length > 0 ? Math.round(Math.max(...validSpeed)) : null;

  // ── Subtitle parts (drop the run-specific training-effect label for kite) ──
  const subtitleParts: { text: string; color?: string }[] = [];
  if (startTimeFormatted)  subtitleParts.push({ text: startTimeFormatted, color: "#71717a" });
  if (teLabel && !isKite)  subtitleParts.push({ text: teLabel, color: teColor });
  if (weatherStr)          subtitleParts.push({ text: weatherStr, color: "#71717a" });

  // ── Sport profile: which metric cards, charts, and map legend to render ──
  type CardProps = { label: string; val: string; unit: string; color: string };
  type ChartProps = { svg: string; label: string; avg: string; peak?: string; color: string; totalDistKm?: number; avgPrefix?: string };
  let metricRows: CardProps[][];
  let chartRows: ChartProps[][];
  let legendGrad: string, legendSlow: string, legendFast: string;

  if (isKite) {
    metricRows = [
      [
        ...(distKm ? [{ label: "Distance", val: distKm, unit: "km", color: "#22c55e" }] : []),
        ...(maxSpeedKmh ? [{ label: "Max Speed", val: maxSpeedKmh, unit: "km/h", color: "#22d3ee" }] : []),
      ],
      [
        ...(avgSpeedKmh ? [{ label: "Avg Speed", val: avgSpeedKmh, unit: "km/h", color: "#38bdf8" }] : []),
        ...(calories ? [{ label: "Calories", val: String(calories), unit: "kcal", color: "#f97316" }] : []),
      ],
    ];
    chartRows = [[
      { svg: speedChart, label: "Speed", avg: avgSpeedKmh ?? "—", peak: peakSpeed ? `${peakSpeed}` : undefined, color: "#22d3ee", totalDistKm: distNum, avgPrefix: "avg" },
      { svg: hrChart, label: "HR", avg: avgHr ? `${avgHr}` : "—", peak: maxHr ? `${maxHr}` : undefined, color: "#f43f5e", totalDistKm: distNum },
    ]];
    legendGrad = "linear-gradient(to right, #0c4a6e, #06b6d4, #cffbff)";
    legendSlow = "#38bdf8"; legendFast = "#cffbff";
  } else {
    metricRows = [
      [
        ...(distKm ? [{ label: "Distance", val: distKm, unit: "km", color: "#22c55e" }] : []),
        ...(pace ? [{ label: "Pace", val: pace, unit: "/km", color: "#00e5ff" }] : []),
      ],
      [
        ...(avgHr ? [{ label: "Avg HR", val: String(avgHr), unit: "bpm", color: "#f43f5e" }] : []),
        ...(calories ? [{ label: "Calories", val: String(calories), unit: "kcal", color: "#f97316" }] : []),
      ],
    ];
    chartRows = [
      [
        { svg: paceChart, label: "Pace", avg: pace ?? "—", peak: peakPace ?? undefined, color: "#00e5ff", totalDistKm: distNum },
        { svg: hrChart, label: "HR", avg: avgHr ? `${avgHr}` : "—", peak: maxHr ? `${maxHr}` : undefined, color: "#f43f5e", totalDistKm: distNum },
      ],
      [
        { svg: elevChart, label: "Elev", avg: elevGain ? `+${elevGain}m` : "—", peak: peakElev ? `${peakElev}m` : undefined, color: "#4ade80", totalDistKm: distNum, avgPrefix: "gain" },
        { svg: cadChart, label: "Cadence", avg: cadence ? `${cadence}` : "—", peak: peakCad ? `${peakCad}` : undefined, color: "#a78bfa", totalDistKm: distNum },
      ],
    ];
    legendGrad = "linear-gradient(to right, #00e5ff, #ffab00, #ff1744)";
    legendSlow = "#00e5ff"; legendFast = "#ff1744";
  }

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
              <img key={i} src={t.dataUri} width={Math.ceil(t.size) + 1} height={Math.ceil(t.size) + 1}
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
            {/* Kite jump markers: a dot per jump, height label on the top 3 */}
            {isKite && jumpMarkers.map((jm, i) => {
              const top3 = jm.rank <= 3;
              // d = the proportional dot size (the fill). The white ring is drawn EXTRA
              // on top of d (content-box), so it never changes the calculated dot size.
              const d = Math.max(6, Math.round(maxDot * (jm.height_m / maxJumpNum)));
              const outline = top3 ? dotOutline : 0;
              const total = d + 2 * outline;
              const fill = hexToRgba(dotCol, top3 ? dotAlpha : dotAlpha * 0.8);
              return (
                <div key={`jm${i}`} style={{ display: "flex", boxSizing: "content-box", position: "absolute", zIndex: 50, left: jm.x - total / 2, top: jm.y - total / 2, width: d, height: d, borderRadius: 999, backgroundColor: fill, border: top3 ? `${outline}px solid #ffffff` : "none" }} />
              );
            })}
            {isKite && jumpMarkers.filter((j) => j.rank <= 3).map((jm, i) => (
              <div key={`jl${i}`} style={{ display: "flex", position: "absolute", zIndex: 60, left: jm.x + 12, top: jm.y - 24, alignItems: "baseline", gap: 2, backgroundColor: "rgba(9,9,11,0.85)", borderRadius: 6, padding: "1px 6px" }}>
                <span style={{ display: "flex", fontSize: 16, fontWeight: 800, color: "#ecfeff" }}>{jm.height_m.toFixed(1)}</span>
                <span style={{ display: "flex", fontSize: 10, color: "#67e8f9" }}>m</span>
              </div>
            ))}
            {/* Legend */}
            {isKite ? (
              <div style={{ display: "flex", position: "absolute", bottom: 10, left: 10, alignItems: "center", gap: 6, backgroundColor: "rgba(9,9,11,0.78)", borderRadius: 8, padding: "4px 10px" }}>
                <div style={{ display: "flex", width: 9, height: 9, borderRadius: 9, backgroundColor: "#0a0a0a", border: "1.5px solid #ffffff" }} />
                <span style={{ display: "flex", fontSize: 12, color: "#a1a1aa" }}>jumps</span>
                <span style={{ display: "flex", fontSize: 12, color: "#3f3f46" }}>·</span>
                <span style={{ display: "flex", fontSize: 12, color: kiteStops[0], fontWeight: 600 }}>slow</span>
                <div style={{ display: "flex", width: 44, height: 4, borderRadius: 2, background: `linear-gradient(to right, ${kiteStops.join(", ")})` }} />
                <span style={{ display: "flex", fontSize: 12, color: kiteStops[kiteStops.length - 1], fontWeight: 600 }}>fast</span>
              </div>
            ) : (
              <div style={{ display: "flex", position: "absolute", bottom: 10, left: 10, alignItems: "center", gap: 6, backgroundColor: "rgba(9,9,11,0.78)", borderRadius: 8, padding: "4px 10px" }}>
                <span style={{ display: "flex", fontSize: 12, color: "#00e5ff", fontWeight: 600 }}>Slow</span>
                <div style={{ display: "flex", width: 48, height: 4, borderRadius: 2, background: "linear-gradient(to right, #00e5ff, #ffab00, #ff1744)" }} />
                <span style={{ display: "flex", fontSize: 12, color: "#ff1744", fontWeight: 600 }}>Fast</span>
              </div>
            )}
            {/* Top-jump arc overlay */}
            {isKite && showArc && hasTraj && (
              <div style={{ display: "flex", flexDirection: "column", position: "absolute", top: 12, right: 12, width: 204, backgroundColor: "rgba(12,14,16,0.9)", borderRadius: 12, padding: "8px 10px 5px", border: "1px solid rgba(255,255,255,0.14)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ display: "flex", fontSize: 10, color: "#a1a1aa", letterSpacing: 1, textTransform: "uppercase" as const }}>Top Jump</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                    <span style={{ display: "flex", fontSize: 20, fontWeight: 800, color: "#ffffff" }}>{topJump.height_m.toFixed(1)}</span>
                    <span style={{ display: "flex", fontSize: 11, color: "#71717a" }}>m</span>
                  </div>
                </div>
                <img src={`data:image/svg+xml,${encodeURIComponent(arcSvg)}`} width={184} height={118} style={{ width: 184, height: 118 }} />
                {(topJump.airtime_s || topJump.distance_m) && (
                  <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
                    {topJump.airtime_s && <span style={{ display: "flex", fontSize: 11, color: "#a1a1aa" }}>{topJump.airtime_s}s air</span>}
                    {topJump.distance_m && <span style={{ display: "flex", fontSize: 11, color: "#a1a1aa" }}>{topJump.distance_m}m flight</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: Data */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-around" }}>

            {isKite ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8, justifyContent: "space-around" }}>
            {/* Hero jump + airtime */}
            <div style={{ display: "flex", gap: 8 }}>
              {maxJumpM && <MetricCard label="Max Jump" val={maxJumpM} unit="m" color="#22d3ee" />}
              {maxAirtime
                ? <MetricCard label="Max Air" val={maxAirtime} unit="s" color="#38bdf8" />
                : <MetricCard label="Jumps" val={String(jumpCount)} unit="" color="#38bdf8" />}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {maxSpeedKn && <MetricCard label="Max Speed" val={maxSpeedKn} unit="kn" color="#22c55e" />}
              {distKm && <MetricCard label="Distance" val={distKm} unit="km" color="#a78bfa" />}
            </div>
            {/* Top jumps ranked bars */}
            {jumps.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, backgroundColor: "#111113", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ display: "flex", fontSize: 12, fontWeight: 600, color: "#52525b", letterSpacing: 2, textTransform: "uppercase" as const }}>TOP JUMPS</span>
                  <span style={{ display: "flex", fontSize: 11, color: "#3f3f46" }}>{jumpCount} total</span>
                </div>
                {jumps.slice(0, 5).map((j, i) => {
                  const pct = maxJumpM ? Math.max(6, (j.height_m / Number(maxJumpM)) * 100) : 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ display: "flex", fontSize: 12, color: "#52525b", width: 18 }}>#{j.rank}</span>
                      <div style={{ display: "flex", flex: 1, height: 11, backgroundColor: "#1c1c1e", borderRadius: 5 }}>
                        <div style={{ display: "flex", width: `${pct.toFixed(0)}%`, height: "100%", backgroundColor: "#22d3ee", borderRadius: 5 }} />
                      </div>
                      <span style={{ display: "flex", fontSize: 14, fontWeight: 700, color: "#ecfeff", width: 46 }}>{j.height_m.toFixed(1)}m</span>
                      {j.airtime_s ? <span style={{ display: "flex", fontSize: 11, color: "#52525b", width: 40 }}>{j.airtime_s}s</span> : <span style={{ display: "flex", width: 40 }} />}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Time on water + HR */}
            <div style={{ display: "flex", gap: 8 }}>
              {movingDur && <MetricCard label="Time on Water" val={movingDur} unit="" color="#38bdf8" />}
              {avgHr && <MetricCard label="Avg HR" val={String(avgHr)} unit="bpm" color="#f43f5e" />}
            </div>
            </div>
            ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8, justifyContent: "space-around" }}>
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
    {
      width: IMG_W,
      height: IMG_H,
      // A given activity's image is immutable — let the CDN serve repeats instantly
      // (each cold render is ~4s of tile fetch + sharp recolor).
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    }
  );
}
