import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Text, Card } from "soma-style";
import type { HrPacePoint } from "../lib/api";

const YEAR_PALETTE = ["#77c8d1", "#e0a458", "#c084fc", "#6ad4a0", "#e06060", "#6aa0e0", "#cbe896"];

function pace(mins: number): string {
  const t = Math.round(mins * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * HR-vs-pace scatter (per run): x = pace (left faster), y = HR (up higher),
 * dot size ~ distance, dot COLOR ~ year. Tap a year chip to show/hide that
 * year; tap a dot to read the run. Web parity (#436).
 */
export function RunningHrPace({ data }: { data: { points: HrPacePoint[] } | null | undefined }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<HrPacePoint | null>(null);
  const all = (data?.points ?? []).filter((p) => p.pace != null && p.hr != null);
  const years = useMemo(() => [...new Set(all.map((p) => p.date.slice(0, 4)))].sort(), [all]);
  if (all.length < 4) return null;

  const yearColor = (y: string) => YEAR_PALETTE[Math.max(0, years.indexOf(y)) % YEAR_PALETTE.length];
  // Axes computed over ALL points so toggling a year doesn't rescale the plot.
  const paces = all.map((p) => p.pace as number);
  const hrs = all.map((p) => p.hr as number);
  const minP = Math.min(...paces), maxP = Math.max(...paces), rP = maxP - minP || 1;
  const minH = Math.min(...hrs), maxH = Math.max(...hrs), rH = maxH - minH || 1;
  const maxD = Math.max(...all.map((p) => p.distance ?? 0)) || 1;
  const H = 150;
  const visible = all.filter((p) => !hidden.has(p.date.slice(0, 4)));

  const toggle = (y: string) => setHidden((prev) => {
    const n = new Set(prev);
    if (n.has(y)) n.delete(y); else n.add(y);
    return n;
  });

  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Heart rate vs pace</Text>
        <Text variant="micro" className="text-text-muted">{visible.length} runs</Text>
      </View>

      {selected ? (
        <View className="flex-row items-center gap-2 self-start rounded-md px-2 py-1" style={{ backgroundColor: "#152028" }}>
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: yearColor(selected.date.slice(0, 4)) }} />
          <Text variant="micro" className="text-text-secondary">
            {(selected.name || "Run")} · {shortDate(selected.date)} · {pace(selected.pace as number)}/km · {Math.round(selected.hr as number)} bpm{selected.distance != null ? ` · ${(selected.distance as number).toFixed(1)} km` : ""}
          </Text>
        </View>
      ) : (
        <Text variant="micro" className="text-text-muted">tap a dot to read a run</Text>
      )}

      <View style={{ position: "relative", height: H }}>
        <Svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
          {visible.map((p, i) => {
            const cx = ((p.pace as number) - minP) / rP * 96 + 2;
            const cy = H - (((p.hr as number) - minH) / rH) * (H - 8) - 4;
            const r = 1.5 + ((p.distance ?? 0) / maxD) * 3.5;
            const sel = selected === p;
            return (
              <Circle
                key={p.date + i}
                cx={cx}
                cy={cy}
                r={sel ? r + 1.5 : r}
                fill={yearColor(p.date.slice(0, 4))}
                fillOpacity={sel ? 1 : 0.6}
                stroke={sel ? "#ffffff" : undefined}
                strokeWidth={sel ? 0.6 : 0}
              />
            );
          })}
        </Svg>
        {/* Transparent tap targets over each dot (Circle onPress is unreliable on RN-web-svg). */}
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: H }} pointerEvents="box-none">
          {visible.map((p, i) => {
            const cx = ((p.pace as number) - minP) / rP * 96 + 2;
            const cy = H - (((p.hr as number) - minH) / rH) * (H - 8) - 4;
            return (
              <Pressable
                key={p.date + i}
                onPress={() => setSelected(p)}
                hitSlop={5}
                style={{ position: "absolute", left: `${cx}%`, top: cy, width: 14, height: 14, marginLeft: -7, marginTop: -7 }}
              />
            );
          })}
        </View>
      </View>

      <View className="flex-row items-center justify-between">
        <Text variant="micro" className="text-text-muted">← {pace(minP)} faster</Text>
        <Text variant="micro" className="text-text-muted">slower {pace(maxP)} →</Text>
      </View>
      <Text variant="micro" className="text-text-muted">HR {Math.round(minH)}–{Math.round(maxH)} bpm (up = higher) · dot = distance</Text>

      {years.length > 1 ? (
        <View className="flex-row flex-wrap gap-2">
          {years.map((y) => {
            const off = hidden.has(y);
            return (
              <Pressable key={y} onPress={() => toggle(y)} hitSlop={4}>
                <View className="flex-row items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: off ? "#142530" : yearColor(y) + "22" }}>
                  <View className="h-2 w-2 rounded-full" style={{ backgroundColor: off ? "#4a5a66" : yearColor(y) }} />
                  <Text variant="micro" style={{ color: off ? "#5a7a8a" : yearColor(y) }}>{y}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}
