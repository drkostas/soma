import { View } from "react-native";
import Svg, { Polyline, Line, Circle } from "react-native-svg";
import { Text } from "soma-style";

/**
 * One data series on a LineChart. Values are aligned to a shared x-index
 * (index i of every series maps to the same x position); `null` marks a gap.
 * - mode "line": connected polyline (dense series — smoothed, trend, goal)
 * - mode "dots": a dot per non-null point (sparse series — actual weigh-ins)
 */
export interface ChartSeries {
  values: (number | null)[];
  color: string;
  width?: number;
  dashed?: boolean;
  mode?: "line" | "dots";
  label?: string;
}

export interface LineChartProps {
  series: ChartSeries[];
  /** x labels aligned to the value index; only first + last are drawn. */
  labels?: string[];
  height?: number;
  /** Format a y value for the axis labels (min/max) and the reference line. */
  yFormat?: (v: number) => string;
  /** Optional horizontal reference line (e.g. a goal pace at y=0). */
  refLine?: { y: number; color?: string };
  /** Additional horizontal reference lines (e.g. ACWR 0.8/1.3/1.5 guides). */
  refLines?: { y: number; color?: string; dashed?: boolean }[];
  yMin?: number;
  yMax?: number;
}

const VBW = 320; // viewBox width; scales uniformly to the container

/** A compact, dependency-free line chart (react-native-svg) with y-axis
 *  min/max labels and first/last x labels. Reused across every app chart. */
export function LineChart({ series, labels, height = 120, yFormat, refLine, refLines, yMin, yMax }: LineChartProps) {
  const fmt = yFormat ?? ((v: number) => String(Math.round(v)));
  const all: number[] = [];
  for (const s of series) for (const v of s.values) if (v != null && isFinite(v)) all.push(v);
  if (refLine && isFinite(refLine.y)) all.push(refLine.y);
  if (refLines) for (const r of refLines) if (isFinite(r.y)) all.push(r.y);
  if (all.length < 2) {
    return <View style={{ height }} className="items-center justify-center"><Text variant="micro" className="text-text-muted">Not enough data yet.</Text></View>;
  }
  const lo = yMin != null ? yMin : Math.min(...all);
  const hi = yMax != null ? yMax : Math.max(...all);
  const range = hi - lo || 1;
  const padTop = 6;
  const padBottom = 6;
  const plotH = height - padTop - padBottom;
  const n = Math.max(...series.map((s) => s.values.length));
  const xAt = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * VBW);
  const yAt = (v: number) => padTop + (1 - (v - lo) / range) * plotH;

  return (
    <View>
      <View className="flex-row">
        <View className="w-9 justify-between" style={{ height, paddingVertical: padTop }}>
          <Text variant="micro" className="text-text-muted tabular-nums">{fmt(hi)}</Text>
          <Text variant="micro" className="text-text-muted tabular-nums">{fmt(lo)}</Text>
        </View>
        <View className="flex-1">
          <Svg width="100%" height={height} viewBox={`0 0 ${VBW} ${height}`}>
            {/* baseline + top gridline */}
            <Line x1={0} y1={yAt(hi)} x2={VBW} y2={yAt(hi)} stroke="#1e2f38" strokeWidth={1} />
            <Line x1={0} y1={yAt(lo)} x2={VBW} y2={yAt(lo)} stroke="#1e2f38" strokeWidth={1} />
            {refLine && refLine.y >= lo && refLine.y <= hi ? (
              <Line x1={0} y1={yAt(refLine.y)} x2={VBW} y2={yAt(refLine.y)} stroke={refLine.color ?? "#3a5563"} strokeWidth={1} strokeDasharray="4 4" />
            ) : null}
            {refLines?.map((r, ri) =>
              r.y >= lo && r.y <= hi ? (
                <Line key={`rl-${ri}`} x1={0} y1={yAt(r.y)} x2={VBW} y2={yAt(r.y)} stroke={r.color ?? "#3a5563"} strokeWidth={1} strokeDasharray={r.dashed === false ? undefined : "4 4"} />
              ) : null,
            )}
            {series.map((s, si) => {
              if (s.mode === "dots") {
                return s.values.map((v, i) =>
                  v == null || !isFinite(v) ? null : (
                    <Circle key={`${si}-${i}`} cx={xAt(i)} cy={yAt(v)} r={2.6} fill={s.color} />
                  ),
                );
              }
              // line mode: split into segments on null gaps
              const segs: string[] = [];
              let cur: string[] = [];
              s.values.forEach((v, i) => {
                if (v == null || !isFinite(v)) { if (cur.length) { segs.push(cur.join(" ")); cur = []; } }
                else cur.push(`${xAt(i)},${yAt(v)}`);
              });
              if (cur.length) segs.push(cur.join(" "));
              return segs.map((pts, gi) => (
                <Polyline
                  key={`${si}-${gi}`}
                  points={pts}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width ?? 2}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ));
            })}
          </Svg>
          {labels && labels.length >= 2 ? (
            <View className="flex-row justify-between">
              <Text variant="micro" className="text-text-muted">{labels[0]}</Text>
              <Text variant="micro" className="text-text-muted">{labels[labels.length - 1]}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** A small colored-line + label legend row for a chart. */
export function ChartLegend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-1">
      {items.map((it) => (
        <View key={it.label} className="flex-row items-center gap-1.5">
          <View style={{ width: 12, height: 0, borderTopWidth: 2, borderColor: it.color, borderStyle: it.dashed ? "dashed" : "solid" }} />
          <Text variant="micro" className="text-text-muted">{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
