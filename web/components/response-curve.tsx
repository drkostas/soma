"use client";

interface Point {
  x: number;
  y: number;
}

export function ResponseCurve({
  points,
  currentX,
  currentY,
  xLabel,
  yLabel,
}: {
  points: Point[];
  currentX: number;
  currentY: number;
  xLabel: string;
  yLabel: string;
}) {
  const w = 200;
  const h = 80;
  const pad = 20;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs, currentX);
  const xMax = Math.max(...xs, currentX);
  const yMin = Math.min(...ys, currentY);
  const yMax = Math.max(...ys, currentY);

  // Avoid division by zero when range is zero
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 0.01;

  const sx = (x: number) => pad + ((x - xMin) / xRange) * (w - 2 * pad);
  const sy = (y: number) =>
    h - pad - ((y - yMin) / yRange) * (h - 2 * pad);

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`)
    .join(" ");

  return (
    <svg width={w} height={h} className="text-xs">
      {/* Transfer function curve */}
      <path
        d={pathD}
        fill="none"
        stroke="oklch(70% 0.1 250)"
        strokeWidth={1.5}
      />
      {/* "You are here" dot */}
      <circle
        cx={sx(currentX)}
        cy={sy(currentY)}
        r={4}
        fill="oklch(80% 0.2 85)"
        stroke="white"
        strokeWidth={1}
      />
      {/* Label for the dot */}
      <text
        x={sx(currentX) + 6}
        y={sy(currentY) - 6}
        fill="oklch(80% 0.15 85)"
        fontSize={9}
      >
        you ({currentX.toFixed(1)} → {currentY.toFixed(3)})
      </text>
      {/* X-axis label */}
      <text
        x={w / 2}
        y={h - 2}
        textAnchor="middle"
        fill="oklch(60% 0 0)"
        fontSize={8}
      >
        {xLabel}
      </text>
      {/* Y-axis label (rotated) */}
      <text
        x={2}
        y={h / 2}
        textAnchor="start"
        fill="oklch(60% 0 0)"
        fontSize={8}
        transform={`rotate(-90 8 ${h / 2})`}
      >
        {yLabel}
      </text>
    </svg>
  );
}
