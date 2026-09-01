import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { Text, Card } from "soma-style";
import type { HeatRoute } from "../lib/api";

/**
 * Route heatmap (web parity, #435): all recent run GPS paths overlaid on one
 * shared, aspect-corrected canvas. The web uses a Leaflet map; on mobile we
 * draw every route as a semi-transparent polyline so overlapping segments
 * (the roads you run most) accumulate into brighter lines — a dependency-free
 * density map. Fed by /api/running/heatmap.
 */
export function RunHeatmap({ routes }: { routes: HeatRoute[] }) {
  const valid = (routes ?? []).filter((r) => Array.isArray(r) && r.length >= 2);
  if (valid.length < 1) return null;

  // Keep only the dominant location cluster (within ~1.5° of the median centroid),
  // matching run-heatmap.native.tsx + web run-heatmap.tsx so a run abroad doesn't
  // stretch the canvas to a whole-world view.
  const centers = valid.map((r) => {
    let sl = 0, sa = 0, c = 0;
    for (const [lng, lat] of r) if (isFinite(lng) && isFinite(lat)) { sl += lng; sa += lat; c++; }
    return c ? ([sl / c, sa / c] as [number, number]) : null;
  });
  const cLngs = centers.filter((x): x is [number, number] => !!x).map((x) => x[0]).sort((a, b) => a - b);
  const cLats = centers.filter((x): x is [number, number] => !!x).map((x) => x[1]).sort((a, b) => a - b);
  const medLo = cLngs.length ? cLngs[Math.floor(cLngs.length / 2)] : 0;
  const medLa = cLats.length ? cLats[Math.floor(cLats.length / 2)] : 0;
  const main = valid.filter((_, i) => { const c = centers[i]; return c != null && Math.abs(c[0] - medLo) <= 1.5 && Math.abs(c[1] - medLa) <= 1.5; });
  if (main.length < 1) return null;

  // Shared bounding box across the dominant cluster.
  let minLo = Infinity, maxLo = -Infinity, minLa = Infinity, maxLa = -Infinity;
  for (const r of main) for (const [lng, lat] of r) {
    if (!isFinite(lng) || !isFinite(lat)) continue;
    if (lng < minLo) minLo = lng; if (lng > maxLo) maxLo = lng;
    if (lat < minLa) minLa = lat; if (lat > maxLa) maxLa = lat;
  }
  if (!isFinite(minLo) || !isFinite(minLa)) return null;
  const rLo = maxLo - minLo || 1e-6;
  const rLa = maxLa - minLa || 1e-6;
  // Correct longitude for latitude compression so shapes aren't stretched.
  const midLa = (minLa + maxLa) / 2;
  const cos = Math.max(0.2, Math.cos((midLa * Math.PI) / 180));
  const spanLo = rLo * cos;
  const span = Math.max(spanLo, rLa) || 1e-6;
  // center each axis within a 100x100 box
  const offX = (100 - (spanLo / span) * 92) / 2;
  const offY = (100 - (rLa / span) * 92) / 2;

  const project = (r: HeatRoute) => {
    const step = Math.max(1, Math.floor(r.length / 120));
    const out: string[] = [];
    for (let i = 0; i < r.length; i += step) {
      const [lng, lat] = r[i];
      if (!isFinite(lng) || !isFinite(lat)) continue;
      const x = offX + ((lng - minLo) * cos / span) * 92;
      const y = offY + (1 - (lat - minLa) / span) * 92;
      out.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return out.join(" ");
  };

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Route heatmap</Text>
        <Text variant="micro" className="text-text-muted">{main.length} routes · last 12 mo</Text>
      </View>
      <View className="rounded-lg bg-surface-subtle overflow-hidden" style={{ aspectRatio: 1 }}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          {main.map((r, i) => (
            <Polyline
              key={i}
              points={project(r)}
              fill="none"
              stroke="#77c8d1"
              strokeWidth={0.7}
              strokeOpacity={0.35}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </Svg>
      </View>
      <Text variant="micro" className="text-text-muted">Brighter lines = roads you run most.</Text>
    </Card>
  );
}
