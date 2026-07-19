import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Polyline, Circle, Line } from "react-native-svg";

/* A tiny axis-less trend line for tier-1 KPI cards (brief §3: "sparkline + big
   number", ~40px tall, no ticks). Measures its own width via onLayout so it fills
   the card, and plots the series normalized to the box. */

interface SparklineProps {
  data: (number | null | undefined)[];
  color?: string;
  height?: number;
  /** Draw a faint baseline at the series mean (helps read above/below-trend). */
  baseline?: boolean;
  /** Dot on the last point. */
  showLast?: boolean;
}

export function Sparkline({
  data,
  color = "#77c8d1",
  height = 40,
  baseline = false,
  showLast = true,
}: SparklineProps) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const nums = data.filter((v): v is number => typeof v === "number" && isFinite(v));
  const canDraw = w > 0 && nums.length >= 2;

  let points = "";
  let lastX = 0;
  let lastY = 0;
  let meanY = 0;
  if (canDraw) {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const pad = 3; // keep the stroke off the edges
    const stepX = (w - pad * 2) / (nums.length - 1);
    const toY = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
    points = nums.map((v, i) => `${pad + i * stepX},${toY(v)}`).join(" ");
    lastX = pad + (nums.length - 1) * stepX;
    lastY = toY(nums[nums.length - 1]);
    meanY = toY(nums.reduce((s, v) => s + v, 0) / nums.length);
  }

  return (
    <View onLayout={onLayout} style={{ height, width: "100%" }}>
      {canDraw ? (
        <Svg width={w} height={height}>
          {baseline ? (
            <Line x1={0} y1={meanY} x2={w} y2={meanY} stroke={color} strokeOpacity={0.18} strokeWidth={1} />
          ) : null}
          <Polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {showLast ? <Circle cx={lastX} cy={lastY} r={2.5} fill={color} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}
