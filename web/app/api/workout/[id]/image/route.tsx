import { ImageResponse } from "@vercel/og";
import { getDb } from "@/lib/db";
import {
  aggregateMuscleVolumes,
  MUSCLE_COLORS,
  MUSCLE_LABELS,
  ALL_MUSCLE_GROUPS,
  type MuscleGroup,
} from "@/lib/muscle-groups";

export const runtime = "nodejs";

// --- SVG polygon data from react-body-highlighter ---

const MUSCLE_TO_LIBRARY: Record<MuscleGroup, string[]> = {
  chest: ["chest"],
  back: ["upper-back", "lower-back", "trapezius"],
  shoulders: ["front-deltoids", "back-deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  forearms: ["forearm"],
  quads: ["quadriceps"],
  hamstrings: ["hamstring"],
  glutes: ["gluteal"],
  calves: ["calves", "left-soleus", "right-soleus"],
  core: ["abs", "obliques"],
};

const LIBRARY_TO_MUSCLE: Record<string, MuscleGroup> = {};
for (const [mg, slugs] of Object.entries(MUSCLE_TO_LIBRARY)) {
  for (const slug of slugs) {
    LIBRARY_TO_MUSCLE[slug] = mg as MuscleGroup;
  }
}

interface BodyPolygon {
  muscle: string;
  svgPoints: string[];
}

const anteriorData: BodyPolygon[] = [
  { muscle: "chest", svgPoints: ["51.84 41.63 51.02 55.1 57.96 57.96 67.76 55.51 70.61 47.35 62.04 41.63", "29.8 46.53 31.43 55.51 40.82 57.96 48.16 55.1 47.76 42.04 37.55 42.04"] },
  { muscle: "obliques", svgPoints: ["68.57 63.27 67.35 57.14 58.78 59.59 60 64.08 60.41 83.27 65.71 78.78 66.53 69.8", "33.88 78.37 33.06 71.84 31.02 63.27 32.24 57.14 40.82 59.18 39.18 63.27 39.18 83.67"] },
  { muscle: "abs", svgPoints: ["56.33 59.18 57.96 64.08 58.37 77.96 58.37 92.65 56.33 98.37 55.1 104.08 51.43 107.76 51.02 84.49 50.61 67.35 51.02 57.14", "43.67 58.78 48.57 57.14 48.98 67.35 48.57 84.49 48.16 107.35 44.49 103.67 40.82 91.43 40.82 78.37 41.22 64.49"] },
  { muscle: "biceps", svgPoints: ["16.73 68.16 17.96 71.43 22.86 66.12 28.98 53.88 27.76 49.39 20.41 55.92", "71.43 49.39 70.2 54.69 76.33 66.12 81.63 71.84 82.86 68.98 78.78 55.51"] },
  { muscle: "triceps", svgPoints: ["69.39 55.51 69.39 61.63 75.92 72.65 77.55 70.2 75.51 67.35", "22.45 69.39 29.8 55.51 29.8 60.82 22.86 73.06"] },
  { muscle: "neck", svgPoints: ["55.51 23.67 50.61 33.47 50.61 39.18 61.63 40 70.61 44.9 69.39 36.73 63.27 35.1 58.37 30.61", "28.98 44.9 30.2 37.14 36.33 35.1 41.22 30.2 44.49 24.49 48.98 33.88 48.57 39.18 37.96 39.59"] },
  { muscle: "front-deltoids", svgPoints: ["78.37 53.06 79.59 47.76 79.18 41.22 75.92 37.96 71.02 36.33 72.24 42.86 71.43 47.35", "28.16 47.35 21.22 53.06 20 47.76 20.41 40.82 24.49 37.14 28.57 37.14 26.94 43.27"] },
  { muscle: "head", svgPoints: ["42.45 2.86 40 11.84 42.04 19.59 46.12 23.27 49.8 25.31 54.69 22.45 57.55 19.18 59.18 10.2 57.14 2.45 49.8 0"] },
  { muscle: "abductors", svgPoints: ["52.65 110.2 54.29 124.9 60 110.2 62.04 100 64.9 94.29 60 92.65 56.73 104.49", "47.76 110.61 44.9 125.31 42.04 115.92 40.41 113.06 39.59 107.35 37.96 102.45 34.69 93.88 39.59 92.24 41.63 99.18 43.67 105.31"] },
  { muscle: "quadriceps", svgPoints: ["34.69 98.78 37.14 108.16 37.14 127.76 34.29 137.14 31.02 132.65 29.39 120 28.16 111.43 29.39 100.82 32.24 94.69", "63.27 105.71 64.49 100 66.94 94.69 70.2 101.22 71.02 111.84 68.16 133.06 65.31 137.55 62.45 128.57 62.04 111.43", "38.78 129.39 38.37 112.24 41.22 118.37 44.49 129.39 42.86 135.1 40 146.12 36.33 146.53 35.51 140", "59.59 145.71 55.51 128.98 60.82 113.88 61.22 130.2 64.08 139.59 62.86 146.53", "32.65 138.37 26.53 145.71 25.71 136.73 25.71 127.35 26.94 114.29 29.39 133.47", "71.84 113.06 73.88 124.08 73.88 140.41 72.65 145.71 66.53 138.37 70.2 133.47"] },
  { muscle: "knees", svgPoints: ["33.88 140 34.69 143.27 35.51 147.35 36.33 151.02 35.1 156.73 29.8 156.73 27.35 152.65 27.35 147.35 30.2 144.08", "65.71 140 72.24 147.76 72.24 152.24 69.8 157.14 64.9 156.73 62.86 151.02"] },
  { muscle: "calves", svgPoints: ["71.43 160.41 73.47 153.47 76.73 161.22 79.59 167.76 78.37 187.76 79.59 195.51 74.69 195.51", "24.9 194.69 27.76 164.9 28.16 160.41 26.12 154.29 24.9 157.55 22.45 161.63 20.82 167.76 22.04 188.16 20.82 195.51", "72.65 195.1 69.8 159.18 65.31 158.37 64.08 162.45 64.08 165.31 65.71 177.14", "35.51 158.37 35.92 162.45 35.92 166.94 35.1 172.24 35.1 176.73 32.24 182.04 30.61 187.35 26.94 194.69 27.35 187.76 28.16 180.41 28.57 175.51 28.98 169.8 29.8 164.08 30.2 158.78"] },
  { muscle: "forearm", svgPoints: ["6.12 88.57 10.2 75.1 14.69 70.2 16.33 74.29 19.18 73.47 4.49 97.55 0 100", "84.49 69.8 83.27 73.47 80 73.06 95.1 98.37 100 100.41 93.47 89.39 89.8 76.33", "77.55 72.24 77.55 77.55 80.41 84.08 85.31 89.8 92.24 101.22 94.69 99.59", "6.94 101.22 13.47 90.61 18.78 84.08 21.63 77.14 21.22 71.84 4.9 98.78"] },
];

const posteriorData: BodyPolygon[] = [
  { muscle: "head", svgPoints: ["50.64 0 45.96 0.85 40.85 5.53 40.43 12.77 45.11 20 55.74 20 59.15 13.62 59.57 4.68 55.74 1.28"] },
  { muscle: "trapezius", svgPoints: ["44.68 21.7 47.66 21.7 47.23 38.3 47.66 64.68 38.3 53.19 35.32 40.85 31.06 36.6 39.15 33.19 43.83 27.23", "52.34 21.7 55.74 21.7 56.6 27.23 60.85 32.77 68.94 36.6 64.68 40.43 61.7 53.19 52.34 64.68 53.19 38.3"] },
  { muscle: "back-deltoids", svgPoints: ["29.36 37.02 22.98 39.15 17.45 44.26 18.3 53.62 24.26 49.36 27.23 46.38", "71.06 37.02 78.3 39.57 82.55 44.68 81.7 53.62 74.89 48.94 72.34 45.11"] },
  { muscle: "upper-back", svgPoints: ["31.06 38.72 28.09 48.94 28.51 55.32 34.04 75.32 47.23 71.06 47.23 66.38 36.6 54.04 33.62 41.28", "68.94 38.72 71.91 49.36 71.49 56.17 65.96 75.32 52.77 71.06 52.77 66.38 63.4 54.47 66.38 41.7"] },
  { muscle: "triceps", svgPoints: ["26.81 49.79 17.87 55.74 14.47 72.34 16.6 81.7 21.7 63.83 26.81 55.74", "73.62 50.21 82.13 55.74 85.96 73.19 83.4 82.13 77.87 62.98 73.19 55.74", "26.81 58.3 26.81 68.51 22.98 75.32 19.15 77.45 22.55 65.53", "72.77 58.3 77.02 64.68 80.43 77.45 76.6 75.32 72.77 68.94"] },
  { muscle: "lower-back", svgPoints: ["47.66 72.77 34.47 77.02 35.32 83.4 49.36 102.13 46.81 82.98", "52.34 72.77 65.53 77.02 64.68 83.4 50.64 102.13 53.19 83.83"] },
  { muscle: "forearm", svgPoints: ["86.38 75.74 91.06 83.4 93.19 94.04 100 106.38 96.17 104.26 88.09 89.36 84.26 83.83", "13.62 75.74 8.94 83.83 6.81 93.62 0 106.38 3.83 104.26 12.34 88.51 15.74 82.98", "81.28 79.57 77.45 77.87 79.15 84.68 91.06 103.83 93.19 108.94 94.47 104.68", "18.72 79.57 22.13 77.87 20.85 84.26 9.36 102.98 6.81 108.51 5.11 104.68"] },
  { muscle: "gluteal", svgPoints: ["44.68 99.57 30.21 108.51 29.79 118.72 31.49 125.96 47.23 121.28 49.36 114.89", "55.32 99.15 51.06 114.47 52.34 120.85 68.09 125.96 69.79 119.15 69.36 108.51"] },
  { muscle: "adductor", svgPoints: ["48.09 122.98 44.68 122.98 41.28 125.53 45.11 144.26 48.51 135.74 48.94 129.36", "51.91 122.55 55.74 123.4 59.15 125.96 54.89 144.26 51.91 136.17 51.06 129.36"] },
  { muscle: "hamstring", svgPoints: ["28.94 122.13 31.06 129.36 36.6 125.96 35.32 135.32 34.47 150.21 29.36 158.3 28.94 146.81 27.66 141.28 27.23 131.49", "71.49 121.7 69.36 128.94 63.83 125.96 65.53 136.6 66.38 150.21 71.06 158.3 71.49 147.66 72.77 142.13 73.62 131.91", "38.72 125.53 44.26 145.96 40.43 166.81 36.17 152.77 37.02 135.32", "61.7 125.53 63.4 136.17 64.26 153.19 60 166.81 56.17 146.38"] },
  { muscle: "knees", svgPoints: ["34.47 153.19 31.06 159.15 33.62 166.38 37.45 162.55", "66.38 153.62 62.98 162.98 66.81 166.38 69.36 159.15"] },
  { muscle: "calves", svgPoints: ["29.36 160.43 28.51 167.23 24.68 179.57 23.83 192.77 25.53 197.02 28.51 193.19 29.79 180 31.91 171.06 31.91 166.81", "37.45 165.11 35.32 167.66 33.19 171.91 31.06 180.43 30.21 191.91 34.04 200 38.72 190.64 39.15 168.94", "62.98 165.11 61.28 168.51 61.7 190.64 66.38 199.57 70.64 191.91 68.94 179.57 66.81 170.21", "70.64 160.43 72.34 168.51 75.74 179.15 76.6 192.77 74.47 196.6 72.34 193.62 70.64 179.57 68.09 168.09"] },
  { muscle: "left-soleus", svgPoints: ["28.51 195.74 30.21 195.74 33.62 201.7 30.64 220 28.51 213.62 26.81 198.3"] },
  { muscle: "right-soleus", svgPoints: ["69.79 195.74 71.91 195.74 73.62 198.3 71.91 213.19 70.21 219.57 67.23 202.13"] },
];

// --- Helpers ---

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  }
  return `${minutes}m`;
}
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return dateStr; }
}
function formatStartTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const h = d.getHours(), m = d.getMinutes().toString().padStart(2, "0");
    return `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
  } catch { return ""; }
}
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}
function getTopSet(sets: any[]): { weight: number; reps: number } | null {
  const working = (sets || []).filter((s: any) => s.type === "normal" && (s.weight_kg || 0) > 0 && (s.reps || 0) > 0);
  if (!working.length) return null;
  const top = working.sort((a: any, b: any) => (b.weight_kg * b.reps) - (a.weight_kg * a.reps))[0];
  return { weight: top.weight_kg, reps: top.reps };
}

// HR chart SVG with min/max labels
function renderHrChartSvg(
  hrSamples: number[],
  durationS: number,
  exercises: any[],
  avgHr: number | null,
): string {
  if (!hrSamples.length || !durationS) return "";
  const W = 984, H = 260;
  const PAD_TOP = 24, PAD_BOT = 8, PAD_LEFT = 0, PAD_RIGHT = 0;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOT;

  let samples = hrSamples;
  if (samples.length > 200) {
    const step = samples.length / 200;
    samples = Array.from({ length: 200 }, (_, i) => hrSamples[Math.round(i * step)]);
  }

  const minHr = Math.max(Math.min(...samples) - 10, 40);
  const maxHr = Math.max(...samples) + 10;
  const hrRange = maxHr - minHr || 1;

  const points = samples.map((hr, i) => {
    const x = PAD_LEFT + (i / (samples.length - 1)) * chartW;
    const y = PAD_TOP + chartH - ((hr - minHr) / hrRange) * chartH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M${points.join(" L")}`;
  const bottomY = PAD_TOP + chartH;
  const areaPath = `${linePath} L${(PAD_LEFT + chartW).toFixed(1)},${bottomY} L${PAD_LEFT},${bottomY} Z`;

  const totalSets = exercises.reduce((sum: number, ex: any) => sum + (ex.sets?.length || 0), 0);
  const segColors = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#06b6d4", "#eab308", "#ec4899"];
  let segSvg = "";
  let setOffset = 0;
  for (let i = 0; i < exercises.length; i++) {
    const sets = exercises[i].sets?.length || 0;
    const x1 = PAD_LEFT + (setOffset / totalSets) * chartW;
    const x2 = PAD_LEFT + ((setOffset + sets) / totalSets) * chartW;
    const color = segColors[i % segColors.length];
    segSvg += `<rect x="${x1.toFixed(1)}" y="${PAD_TOP}" width="${(x2 - x1).toFixed(1)}" height="${chartH}" fill="${color}" opacity="0.22"/>`;
    if (i > 0) segSvg += `<line x1="${x1.toFixed(1)}" y1="${PAD_TOP}" x2="${x1.toFixed(1)}" y2="${bottomY}" stroke="#27272a" stroke-width="1"/>`;
    setOffset += sets;
  }

  let avgLine = "";
  if (avgHr && avgHr >= minHr && avgHr <= maxHr) {
    const avgY = PAD_TOP + chartH - ((avgHr - minHr) / hrRange) * chartH;
    avgLine = `<line x1="${PAD_LEFT}" y1="${avgY.toFixed(1)}" x2="${(PAD_LEFT + chartW).toFixed(1)}" y2="${avgY.toFixed(1)}" stroke="#f43f5e" stroke-width="1" opacity="0.35"/>`;
  }

  const realMax = Math.max(...samples);
  const realMin = Math.min(...samples);
  const minLabel = `<text x="6" y="${H - 6}" font-size="22" fill="#6b7280" font-family="sans-serif">${realMin} bpm</text>`;
  const maxLabel = `<text x="6" y="${PAD_TOP - 4}" font-size="22" fill="#6b7280" font-family="sans-serif">${realMax} bpm</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${segSvg}<path d="${areaPath}" fill="rgba(244,63,94,0.12)"/><path d="${linePath}" fill="none" stroke="#f43f5e" stroke-width="2.5"/>${avgLine}${minLabel}${maxLabel}</svg>`;
}

function getExerciseSegments(exercises: any[]): { title: string; sets: number; color: string }[] {
  const segColors = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#06b6d4", "#eab308", "#ec4899"];
  return exercises.map((ex, i) => ({
    title: ex.title || "Unknown",
    sets: ex.sets?.length || 0,
    color: segColors[i % segColors.length],
  }));
}

function getMuscleColor(slug: string, muscleData: Record<MuscleGroup, { total: number }>, maxVolume: number, bodyColor: string): string {
  const mg = LIBRARY_TO_MUSCLE[slug];
  if (!mg) return bodyColor;
  const total = muscleData[mg]?.total ?? 0;
  if (total <= 0) return bodyColor;
  return hexToRgba(MUSCLE_COLORS[mg].hex, 0.25 + (total / maxVolume) * 0.7);
}

function renderBodySvg(data: BodyPolygon[], muscleData: Record<MuscleGroup, { total: number }>, maxVolume: number): string {
  const bodyColor = "#2a2a2e";
  let polygons = "";
  for (const entry of data) {
    const color = getMuscleColor(entry.muscle, muscleData, maxVolume, bodyColor);
    for (const points of entry.svgPoints) {
      polygons += `<polygon points="${points}" fill="${color}" stroke="${bodyColor}" stroke-width="0.3"/>`;
    }
  }
  return polygons;
}

// --- Constants ---
const IMG_W = 1080;
const IMG_H = 1920;
const SIDE = 36;

// --- Route Handler ---

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = getDb();

  const workoutRows = await sql`
    SELECT raw_json FROM hevy_raw_data
    WHERE endpoint_name = 'workout' AND raw_json->>'id' = ${id}
    LIMIT 1
  `;
  if (!workoutRows.length) return new Response("Not found", { status: 404 });

  const workout = workoutRows[0].raw_json;
  const exercises = Array.isArray(workout.exercises) ? workout.exercises : [];

  const enrichmentRows = await sql`
    SELECT avg_hr, max_hr, calories, duration_s, hr_samples, hr_source
    FROM workout_enrichment WHERE hevy_id = ${id} LIMIT 1
  `;
  const enrichment = enrichmentRows.length > 0 ? enrichmentRows[0] : null;
  const hasRealHr = enrichment?.hr_source === "daily";

  const title = workout.title || "Workout";
  const startTime = workout.start_time || "";
  let durationS = enrichment?.duration_s || 0;
  if (!durationS && startTime && workout.end_time) {
    try { durationS = (new Date(workout.end_time).getTime() - new Date(startTime).getTime()) / 1000; } catch { /**/ }
  }

  let workingSets = 0, totalVolume = 0, totalReps = 0;
  for (const ex of exercises) {
    for (const s of ex.sets || []) {
      if (s.type === "normal" && (s.weight_kg || 0) > 0 && (s.reps || 0) > 0) {
        workingSets++;
        totalVolume += (s.weight_kg || 0) * (s.reps || 0);
        totalReps += s.reps || 0;
      }
    }
  }
  const volumeDisplay = totalVolume >= 1000
    ? `${(totalVolume / 1000).toFixed(1)}t`
    : `${Math.round(totalVolume)}kg`;

  // Muscle data
  const muscleData = aggregateMuscleVolumes(
    exercises.map((ex: any) => ({
      title: ex.title || "",
      sets: (ex.sets || []).map((s: any) => ({ type: s.type || "normal", weight_kg: s.weight_kg || 0, reps: s.reps || 0 })),
    }))
  );
  const maxVolume = Math.max(...ALL_MUSCLE_GROUPS.map((mg) => muscleData[mg].total), 1);
  const topMuscles = ALL_MUSCLE_GROUPS
    .filter((mg) => muscleData[mg].total > 0)
    .sort((a, b) => muscleData[b].total - muscleData[a].total)
    .slice(0, 6);

  // Body SVGs
  const anteriorPolygons = renderBodySvg(anteriorData, muscleData, maxVolume);
  const posteriorPolygons = renderBodySvg(posteriorData, muscleData, maxVolume);

  // HR chart
  const hrSamples: number[] = (hasRealHr && enrichment?.hr_samples)
    ? (Array.isArray(enrichment.hr_samples) ? enrichment.hr_samples : [])
    : [];
  const hrChartSvg = hasRealHr ? renderHrChartSvg(hrSamples, durationS, exercises, enrichment?.avg_hr) : "";
  const exerciseSegments = getExerciseSegments(exercises);
  const totalSets = exerciseSegments.reduce((sum, s) => sum + s.sets, 0);
  const hrImgWidth = IMG_W - SIDE * 2;
  const hrImgHeight = Math.round(hrImgWidth * (180 / 984));

  // Exercise list (cap based on HR presence)
  const segColors = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#06b6d4", "#eab308", "#ec4899"];
  const maxExercises = hrChartSvg ? 5 : 9;
  const displayExercises = exercises.slice(0, maxExercises);
  const hiddenCount = exercises.length - displayExercises.length;

  // Start time
  const startTimeFormatted = formatStartTime(startTime);

  // ── Metric card component ──
  function MetricCard({ label, val, unit, color }: { label: string; val: string; unit: string; color: string }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", backgroundColor: "#18181b", borderRadius: 16, padding: "18px 22px", flex: 1, gap: 6 }}>
        <div style={{ display: "flex", fontSize: 20, color: "#71717a", textTransform: "uppercase" as const, letterSpacing: 1.5 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ display: "flex", fontSize: 56, fontWeight: 800, color, lineHeight: 1 }}>{val}</span>
          <span style={{ display: "flex", fontSize: 20, color: "#52525b", alignSelf: "flex-end", marginBottom: 4 }}>{unit}</span>
        </div>
      </div>
    );
  }

  return new ImageResponse(
    (
      <div style={{
        display: "flex", flexDirection: "column",
        width: "100%", height: "100%",
        backgroundColor: "#09090b",
        padding: `36px ${SIDE}px 32px`,
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#fafafa",
        gap: 16,
      }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", width: 40, height: 6, backgroundColor: "#10b981", borderRadius: 3 }} />
              <span style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#10b981", letterSpacing: 6 }}>SOMA</span>
            </div>
            <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: "#fafafa", lineHeight: 1.05 }}>{title}</div>
            {startTimeFormatted && (
              <div style={{ display: "flex", fontSize: 26, color: "#71717a", marginTop: 10 }}>{startTimeFormatted}</div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, paddingTop: 10, flexShrink: 0 }}>
            <div style={{ display: "flex", fontSize: 24, color: "#a1a1aa" }}>{formatDate(startTime)}</div>
            {durationS > 0 && <div style={{ display: "flex", fontSize: 22, color: "#52525b" }}>{formatDuration(durationS)}</div>}
          </div>
        </div>

        {/* ── Body silhouettes + Full body scan ── */}
        <div style={{ display: "flex", gap: 28, alignItems: "stretch" }}>
          {/* Bodies */}
          <div style={{ display: "flex", gap: 20, flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span style={{ display: "flex", fontSize: 20, color: "#52525b", letterSpacing: 2 }}>FRONT</span>
              <img width={300} height={600}
                src={`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200">${anteriorPolygons}</svg>`)}`} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span style={{ display: "flex", fontSize: 20, color: "#52525b", letterSpacing: 2 }}>BACK</span>
              <img width={273} height={600}
                src={`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 220">${posteriorPolygons}</svg>`)}`} />
            </div>
          </div>

          {/* Full muscle scan — all groups, active highlighted, inactive ghosted */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: "#52525b", letterSpacing: 3, textTransform: "uppercase" as const }}>
              MUSCLES
            </div>
            {ALL_MUSCLE_GROUPS.map((mg) => {
              const pct = Math.round((muscleData[mg].total / maxVolume) * 100);
              const isActive = pct > 0;
              return (
                <div key={mg} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", width: 14, height: 14, borderRadius: 4, backgroundColor: isActive ? MUSCLE_COLORS[mg].hex : "#27272a", flexShrink: 0 }} />
                  <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ display: "flex", fontSize: 18, color: isActive ? "#d4d4d8" : "#3f3f46", fontWeight: isActive ? 600 : 400 }}>{MUSCLE_LABELS[mg]}</span>
                      {isActive && <span style={{ display: "flex", fontSize: 18, color: "#71717a" }}>{pct}%</span>}
                    </div>
                    <div style={{ display: "flex", height: 6, backgroundColor: "#1c1c1e", borderRadius: 3, marginTop: 3 }}>
                      {isActive && <div style={{ display: "flex", width: `${pct}%`, height: "100%", backgroundColor: MUSCLE_COLORS[mg].hex, borderRadius: 3, opacity: 0.85 }} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 4 metric cards 2×2 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 14 }}>
            <MetricCard label="Sets"    val={String(workingSets)} unit="sets" color="#eab308" />
            <MetricCard label="Volume"  val={volumeDisplay}       unit=""     color="#3b82f6" />
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <MetricCard label="Calories" val={enrichment?.calories ? String(enrichment.calories) : "—"} unit="kcal" color="#f97316" />
            <MetricCard label="Avg HR"   val={enrichment?.avg_hr  ? String(enrichment.avg_hr)  : "—"} unit="bpm"  color="#f43f5e" />
          </div>
        </div>

        {/* ── HR chart ── */}
        {hrChartSvg && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: "#52525b", letterSpacing: 3, textTransform: "uppercase" as const }}>
              HEART RATE
            </div>
            <img width={hrImgWidth} height={hrImgHeight}
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(hrChartSvg)}`}
              style={{ borderRadius: 8 }} />
            {/* Exercise labels */}
            <div style={{ display: "flex", width: "100%" }}>
              {exerciseSegments.map((seg, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: `${((seg.sets / totalSets) * 100).toFixed(1)}%`, gap: 4, overflow: "hidden" }}>
                  <div style={{ display: "flex", width: 10, height: 10, borderRadius: 5, backgroundColor: seg.color }} />
                  <div style={{ display: "flex", fontSize: 16, color: "#a1a1aa", textAlign: "center" as const, lineHeight: 1.2 }}>{seg.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Exercise list ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: "#52525b", letterSpacing: 3, textTransform: "uppercase" as const }}>
            EXERCISES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {displayExercises.map((ex: any, i: number) => {
              const workSets = (ex.sets || []).filter((s: any) => s.type === "normal" && (s.weight_kg || 0) > 0);
              const topSet = getTopSet(ex.sets || []);
              const color = segColors[i % segColors.length];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, backgroundColor: "#111113", borderRadius: 14, padding: "10px 18px" }}>
                  <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, backgroundColor: color, flexShrink: 0 }} />
                  <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <span style={{ display: "flex", fontSize: 26, fontWeight: 600, color: "#e4e4e7" }}>{ex.title || "Unknown"}</span>
                    <span style={{ display: "flex", fontSize: 20, color: "#52525b" }}>{workSets.length} sets{topSet ? ` · ${Number(topSet.weight.toFixed(1))}kg × ${topSet.reps}` : ""}</span>
                  </div>
                </div>
              );
            })}
            {hiddenCount > 0 && (
              <div style={{ display: "flex", justifyContent: "center", padding: "8px", fontSize: 16, color: "#3f3f46" }}>
                + {hiddenCount} more exercise{hiddenCount > 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1c1c1e", paddingTop: 16 }}>
          <div style={{ display: "flex", fontSize: 18, color: "#3f3f46" }}>github.com/drkostas/soma</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", width: 24, height: 4, backgroundColor: "#10b981", borderRadius: 2 }} />
            <span style={{ display: "flex", fontSize: 22, fontWeight: 800, color: "#10b981", letterSpacing: 5 }}>SOMA</span>
          </div>
        </div>
      </div>
    ),
    { width: IMG_W, height: IMG_H }
  );
}
