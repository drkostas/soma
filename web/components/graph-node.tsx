"use client";

import { useCallback } from "react";
import type { GraphNode } from "@/lib/training-engine";

// ── Value formatting ──────────────────────────────────────────

function formatValue(value: number | null, unit: string): string {
  if (value === null) return "—";

  switch (unit) {
    case "s/km": {
      const m = Math.floor(value / 60);
      const s = Math.round(value % 60);
      return `${m}:${s.toString().padStart(2, "0")}/km`;
    }
    case "σ":
      return `${value >= 0 ? "+" : ""}${value.toFixed(2)}σ`;
    case "×":
      return `×${value.toFixed(3)}`;
    case "hrs":
      return `${value.toFixed(1)}h`;
    case "bpm":
      return `${Math.round(value)} bpm`;
    case "kg":
      return `${value.toFixed(1)} kg`;
    case "ms":
      return `${Math.round(value)} ms`;
    default:
      return value.toFixed(1);
  }
}

// ── Props ─────────────────────────────────────────────────────

export interface GraphNodeProps {
  node: GraphNode;
  x: number;
  y: number;
  isDraggable?: boolean;
  onDrag?: (value: number) => void;
  shadowValue?: number | null;
  /** Cascade delay (ms) applied to transitions for column-staggered wave effect */
  cascadeDelay?: number;
  onMouseEnter?: (nodeId: string, rect: { x: number; y: number; w: number; h: number }) => void;
  onMouseLeave?: (nodeId: string) => void;
  onClick?: (nodeId: string) => void;
}

const NODE_W = 140;
const NODE_H = 64;
const NODE_RX = 8;

export { NODE_W, NODE_H };

export function GraphNodeComponent({
  node,
  x,
  y,
  isDraggable,
  shadowValue,
  cascadeDelay = 0,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: GraphNodeProps) {
  const hasShadow =
    shadowValue !== undefined &&
    shadowValue !== null &&
    node.value !== null &&
    shadowValue !== node.value;

  const handleMouseEnter = useCallback(() => {
    onMouseEnter?.(node.id, { x, y, w: NODE_W, h: NODE_H });
  }, [node.id, x, y, onMouseEnter]);

  const handleMouseLeave = useCallback(() => {
    onMouseLeave?.(node.id);
  }, [node.id, onMouseLeave]);

  const handleClick = useCallback(() => {
    onClick?.(node.id);
  }, [node.id, onClick]);

  // Scale fill opacity by how far the node is from its neutral point
  const activationIntensity = Math.min(0.85, 0.3 + Math.abs(node.normalizedValue ?? 0) * 0.5);

  const hasValue = node.value != null;

  return (
    <g
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      className="graph-node-group"
      style={{
        cursor: isDraggable ? "ew-resize" : "pointer",
        transition: "transform 200ms ease, opacity 300ms ease",
        transformOrigin: `${x + NODE_W / 2}px ${y + NODE_H / 2}px`,
        opacity: hasValue ? 1 : 0.4,
      }}
    >
      {/* Background fill — opacity scales with activation intensity */}
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={NODE_RX}
        fill={node.color}
        fillOpacity={activationIntensity}
        stroke={node.color}
        strokeWidth={hasShadow ? 2 : 1}
        style={{
          transition: "fill 300ms ease, fill-opacity 300ms ease, stroke 300ms ease, stroke-width 200ms ease",
          transitionDelay: cascadeDelay ? `${cascadeDelay}ms` : undefined,
        }}
      />

      {/* Shadow highlight overlay */}
      {hasShadow && (
        <rect
          x={x}
          y={y}
          width={NODE_W}
          height={NODE_H}
          rx={NODE_RX}
          fill="oklch(85% 0.15 85)"
          fillOpacity={0.3}
          stroke="none"
          pointerEvents="none"
        />
      )}

      {/* Label */}
      <text
        x={x + NODE_W / 2}
        y={y + 20}
        textAnchor="middle"
        className="fill-muted-foreground"
        style={{ fontSize: 10, pointerEvents: "none" }}
      >
        {node.label}
      </text>

      {/* Value */}
      <text
        x={x + NODE_W / 2}
        y={y + 38}
        textAnchor="middle"
        className="fill-foreground"
        style={{
          fontSize: 12,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontWeight: 500,
          pointerEvents: "none",
          transition: "fill 300ms ease, opacity 300ms ease",
          transitionDelay: cascadeDelay ? `${cascadeDelay}ms` : undefined,
        }}
      >
        {hasValue ? formatValue(node.value, node.unit) : "no data"}
      </text>

      {/* Shadow value (delta indicator) */}
      {hasShadow && (
        <text
          x={x + NODE_W / 2}
          y={y + 54}
          textAnchor="middle"
          fill="oklch(75% 0.15 85)"
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            pointerEvents: "none",
          }}
        >
          → {formatValue(shadowValue, node.unit)}
        </text>
      )}

      {/* Draggable indicator */}
      {isDraggable && (
        <text
          x={x + NODE_W - 10}
          y={y + 18}
          textAnchor="middle"
          fill={node.color}
          style={{ fontSize: 10, pointerEvents: "none" }}
        >
          ⇔
        </text>
      )}
    </g>
  );
}
