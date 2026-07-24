import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Text, Card } from "soma-style";
import type { HrPacePoint } from "../lib/api";

function pace(mins: number): string {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * HR-vs-pace scatter (per run): x = pace (left faster), y = HR (up higher),
 * dot size ~ distance. Mobile-adapted from the web's year-toggle scatter.
 */
export function RunningHrPace({ data }: { data: { points: HrPacePoint[] } | null | undefined }) {
  const pts = (data?.points ?? []).filter((p) => p.pace != null && p.hr != null);
  if (pts.length < 4) return null;

  const paces = pts.map((p) => p.pace as number);
  const hrs = pts.map((p) => p.hr as number);
  const minP = Math.min(...paces), maxP = Math.max(...paces), rP = maxP - minP || 1;
  const minH = Math.min(...hrs), maxH = Math.max(...hrs), rH = maxH - minH || 1;
  const dists = pts.map((p) => p.distance ?? 0);
  const maxD = Math.max(...dists) || 1;
  const H = 150;

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Heart rate vs pace</Text>
        <Text variant="micro" className="text-text-muted">{pts.length} runs</Text>
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
        {pts.map((p, i) => {
          const cx = ((p.pace as number) - minP) / rP * 96 + 2;
          const cy = H - (((p.hr as number) - minH) / rH) * (H - 8) - 4;
          const r = 1.5 + ((p.distance ?? 0) / maxD) * 3.5;
          return <Circle key={i} cx={cx} cy={cy} r={r} fill="#77c8d1" fillOpacity={0.55} />;
        })}
      </Svg>
      <View className="flex-row items-center justify-between">
        <Text variant="micro" className="text-text-muted">← {pace(minP)} faster</Text>
        <Text variant="micro" className="text-text-muted">slower {pace(maxP)} →</Text>
      </View>
      <Text variant="micro" className="text-text-muted">HR {Math.round(minH)}–{Math.round(maxH)} bpm (up = higher) · dot = distance</Text>
    </Card>
  );
}
