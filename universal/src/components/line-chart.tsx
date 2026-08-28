import { useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent, type GestureResponderEvent } from "react-native";
import Svg, { Polyline, Line, Circle } from "react-native-svg";
import { Text, Modal } from "soma-style";

/**
 * One data series on a LineChart. Values align to a shared x-index; `null` is a gap.
 * - mode "line": connected polyline · mode "dots": a dot per non-null point
 * - axis "right": scaled to a secondary right-hand y-axis (dual-axis charts)
 * - sizes: per-point radius for dots mode (scatter with variable dot size)
 */
export interface ChartSeries {
  values: (number | null)[];
  color: string;
  width?: number;
  dashed?: boolean;
  mode?: "line" | "dots";
  label?: string;
  axis?: "left" | "right";
  sizes?: (number | null)[];
}

export interface LineChartProps {
  series: ChartSeries[];
  /** x labels aligned to the value index. */
  labels?: string[];
  height?: number;
  /** Format a left-axis y value (also the reference-line labels). */
  yFormat?: (v: number) => string;
  /** Format a right-axis y value (dual-axis). */
  yFormatRight?: (v: number) => string;
  refLine?: { y: number; color?: string };
  refLines?: { y: number; color?: string; dashed?: boolean }[];
  yMin?: number;
  yMax?: number;
  /** Number of evenly-spaced x labels to draw (default 2 = first + last). */
  xTicks?: number;
  /** Enable tap/drag to read the exact value(s) at a point. */
  interactive?: boolean;
}

const VBW = 320;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** ISO date → "Mon D" (used by the interactive callout when labels look like dates). */
export function chartDateLabel(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : iso;
}

/** A compact react-native-svg line/scatter chart with y-axis labels, dated x
 *  ticks, an optional right axis, and optional tap-to-read cursor + callout. */
export function LineChart(props: LineChartProps) {
  const { series, labels, height = 120, yFormat, yFormatRight, refLine, refLines, yMin, yMax, xTicks, interactive } = props;
  const fmtL = yFormat ?? ((v: number) => String(Math.round(v)));
  const fmtR = yFormatRight ?? fmtL;
  const [active, setActive] = useState<number | null>(null);
  const [plotW, setPlotW] = useState(0);

  const leftS = series.filter((s) => s.axis !== "right");
  const rightS = series.filter((s) => s.axis === "right");
  const gather = (ss: ChartSeries[], extra: number[] = []) => {
    const all = [...extra];
    for (const s of ss) for (const v of s.values) if (v != null && isFinite(v)) all.push(v);
    return all;
  };
  const lExtra: number[] = [];
  if (refLine && isFinite(refLine.y)) lExtra.push(refLine.y);
  if (refLines) for (const r of refLines) if (isFinite(r.y)) lExtra.push(r.y);
  const lAll = gather(leftS, lExtra);
  const rAll = gather(rightS);

  if (lAll.length + rAll.length < 2) {
    return (
      <View style={{ height }} className="items-center justify-center">
        <Text variant="micro" className="text-text-muted">Not enough data yet.</Text>
      </View>
    );
  }

  const loL = yMin != null ? yMin : Math.min(...lAll);
  const hiL = yMax != null ? yMax : Math.max(...lAll);
  const rangeL = hiL - loL || 1;
  const loR = rAll.length ? Math.min(...rAll) : 0;
  const hiR = rAll.length ? Math.max(...rAll) : 1;
  const rangeR = hiR - loR || 1;
  const padTop = 6;
  const padBottom = 6;
  const plotH = height - padTop - padBottom;
  const n = Math.max(...series.map((s) => s.values.length));
  const xAt = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * VBW);
  const yAtL = (v: number) => padTop + (1 - (v - loL) / rangeL) * plotH;
  const yAtR = (v: number) => padTop + (1 - (v - loR) / rangeR) * plotH;
  const yOf = (s: ChartSeries, v: number) => (s.axis === "right" ? yAtR(v) : yAtL(v));

  // x tick indices
  const tickCount = xTicks && xTicks > 2 ? Math.min(xTicks, n) : 2;
  const tickIdx = labels && labels.length >= 2
    ? (tickCount <= 2 ? [0, n - 1] : Array.from({ length: tickCount }, (_, k) => Math.round((k / (tickCount - 1)) * (n - 1))))
    : [];

  const onTouch = (e: GestureResponderEvent) => {
    if (!interactive || plotW <= 0 || n <= 1) return;
    const x = e.nativeEvent.locationX;
    const i = Math.max(0, Math.min(n - 1, Math.round((x / plotW) * (n - 1))));
    setActive(i);
  };
  const onLayout = (e: LayoutChangeEvent) => setPlotW(e.nativeEvent.layout.width);

  // Active-point callout data
  const callout = active != null
    ? {
        i: active,
        label: labels?.[active] ? (String(labels[active]).match(/^\d{4}-\d{2}-\d{2}/) ? chartDateLabel(String(labels[active])) : String(labels[active])) : "",
        rows: series
          .map((s) => ({ color: s.color, v: s.values[active], fmt: s.axis === "right" ? fmtR : fmtL, label: s.label }))
          .filter((r) => r.v != null && isFinite(Number(r.v))),
        leftPct: n <= 1 ? 0 : (active / (n - 1)) * 100,
      }
    : null;

  return (
    <View>
      <View className="flex-row">
        {/* left axis labels */}
        <View className="w-9 justify-between" style={{ height, paddingVertical: padTop }}>
          <Text variant="micro" className="text-text-muted tabular-nums">{fmtL(hiL)}</Text>
          <Text variant="micro" className="text-text-muted tabular-nums">{fmtL(loL)}</Text>
        </View>

        <View
          className="flex-1"
          onLayout={onLayout}
          onStartShouldSetResponder={() => !!interactive}
          onMoveShouldSetResponder={() => !!interactive}
          onResponderGrant={onTouch}
          onResponderMove={onTouch}
          onResponderRelease={() => interactive && setActive(null)}
        >
          <Svg width="100%" height={height} viewBox={`0 0 ${VBW} ${height}`}>
            <Line x1={0} y1={yAtL(hiL)} x2={VBW} y2={yAtL(hiL)} stroke="#1e2f38" strokeWidth={1} />
            <Line x1={0} y1={yAtL(loL)} x2={VBW} y2={yAtL(loL)} stroke="#1e2f38" strokeWidth={1} />
            {refLine && refLine.y >= loL && refLine.y <= hiL ? (
              <Line x1={0} y1={yAtL(refLine.y)} x2={VBW} y2={yAtL(refLine.y)} stroke={refLine.color ?? "#3a5563"} strokeWidth={1} strokeDasharray="4 4" />
            ) : null}
            {refLines?.map((r, ri) =>
              r.y >= loL && r.y <= hiL ? (
                <Line key={`rl-${ri}`} x1={0} y1={yAtL(r.y)} x2={VBW} y2={yAtL(r.y)} stroke={r.color ?? "#3a5563"} strokeWidth={1} strokeDasharray={r.dashed === false ? undefined : "4 4"} />
              ) : null,
            )}
            {series.map((s, si) => {
              if (s.mode === "dots") {
                return s.values.map((v, i) =>
                  v == null || !isFinite(v) ? null : (
                    <Circle key={`${si}-${i}`} cx={xAt(i)} cy={yOf(s, v)} r={s.sizes?.[i] != null ? Math.max(1.4, Number(s.sizes[i])) : 2.6} fill={s.color} fillOpacity={s.sizes ? 0.55 : 1} />
                  ),
                );
              }
              const segs: string[] = [];
              let cur: string[] = [];
              s.values.forEach((v, i) => {
                if (v == null || !isFinite(v)) { if (cur.length) { segs.push(cur.join(" ")); cur = []; } }
                else cur.push(`${xAt(i)},${yOf(s, v)}`);
              });
              if (cur.length) segs.push(cur.join(" "));
              return segs.map((pts, gi) => (
                <Polyline key={`${si}-${gi}`} points={pts} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
              ));
            })}
            {/* interactive cursor */}
            {callout != null ? (
              <>
                <Line x1={xAt(callout.i)} y1={0} x2={xAt(callout.i)} y2={height} stroke="#77c8d1" strokeWidth={1} strokeDasharray="2 3" />
                {series.map((s, si) => {
                  const v = s.values[callout.i];
                  return v == null || !isFinite(Number(v)) ? null : (
                    <Circle key={`ac-${si}`} cx={xAt(callout.i)} cy={yOf(s, Number(v))} r={3.2} fill={s.color} stroke="#0c1519" strokeWidth={1} />
                  );
                })}
              </>
            ) : null}
          </Svg>

          {/* right axis labels */}
          {rightS.length ? (
            <View className="absolute right-0 top-0 items-end justify-between" style={{ height, paddingVertical: padTop }} pointerEvents="none">
              <Text variant="micro" className="text-text-muted tabular-nums">{fmtR(hiR)}</Text>
              <Text variant="micro" className="text-text-muted tabular-nums">{fmtR(loR)}</Text>
            </View>
          ) : null}

          {/* interactive callout box */}
          {callout != null ? (
            <View pointerEvents="none" className="absolute top-0 rounded-md px-2 py-1" style={{ left: `${Math.max(0, Math.min(70, callout.leftPct - 15))}%`, backgroundColor: "#152028", borderWidth: 1, borderColor: "#2a3a48" }}>
              {callout.label ? <Text variant="micro" className="text-text-muted">{callout.label}</Text> : null}
              {callout.rows.map((r, ri) => (
                <View key={ri} className="flex-row items-center gap-1">
                  <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} />
                  <Text variant="micro" className="tabular-nums text-text">{r.fmt(Number(r.v))}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* x tick labels */}
          {tickIdx.length ? (
            tickCount <= 2 ? (
              <View className="flex-row justify-between">
                <Text variant="micro" className="text-text-muted">{labels![0]}</Text>
                <Text variant="micro" className="text-text-muted">{labels![labels!.length - 1]}</Text>
              </View>
            ) : (
              <View style={{ height: 14 }}>
                {tickIdx.map((idx, k) => (
                  <Text key={k} variant="micro" className="text-text-muted absolute" style={{ left: `${Math.max(0, Math.min(92, (idx / (n - 1)) * 100 - 3))}%` }}>
                    {labels![idx] ? (String(labels![idx]).match(/^\d{4}-\d{2}-\d{2}/) ? chartDateLabel(String(labels![idx])) : String(labels![idx])) : ""}
                  </Text>
                ))}
              </View>
            )
          ) : null}
        </View>
      </View>
      {interactive && active == null ? (
        <Text variant="micro" className="text-text-muted mt-0.5 text-center" style={{ opacity: 0.6 }}>tap the chart to read values</Text>
      ) : null}
    </View>
  );
}

/** A colored-line + label legend row for a chart. */
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

/** Wraps a chart card with a maximize affordance that opens the same chart,
 *  taller + interactive, in a Modal. Pass the inline chart as children and the
 *  LineChart props to render big in the modal. */
export function ExpandableChart({
  title,
  children,
  chart,
}: {
  title: string;
  children: ReactNode;
  chart: LineChartProps;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">{title}</Text>
        <Text variant="micro" className="text-teal" onPress={() => setOpen(true)}>⤢ expand</Text>
      </View>
      {children}
      <Modal visible={open} onClose={() => setOpen(false)} title={title}>
        <LineChart {...chart} height={300} interactive xTicks={chart.xTicks ?? 4} />
      </Modal>
    </View>
  );
}
