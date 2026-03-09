"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { ComputationGraph, GraphNode, NodeColumn } from "@/lib/training-engine";
import { GraphNodeComponent, NODE_W, NODE_H } from "@/components/graph-node";
import { GraphTooltip } from "@/components/graph-tooltip";

// ── Layout constants ──────────────────────────────────────────

const COL_X: Record<NodeColumn, number> = {
  raw: 20,
  stream: 180,
  merge: 340,
  output: 500,
};

const COL_LABELS: Record<NodeColumn, string> = {
  raw: "Raw Signals",
  stream: "Streams",
  merge: "Merge",
  output: "Output",
};

const PADDING_TOP = 20;
const NODE_SPACING = 62;
const SVG_WIDTH = 640;
const BEZIER_OFFSET = 0.4;

// ── Tooltip state ─────────────────────────────────────────────

interface TooltipState {
  nodeId: string;
  depth: "quick" | "deep";
  x: number;
  y: number;
}

// ── Props ─────────────────────────────────────────────────────

interface ComputationGraphProps {
  graph: ComputationGraph;
  shadowGraph?: ComputationGraph | null;
  sliderValue: number;
  onSliderChange: (value: number) => void;
  onHoverDate?: (date: string | null) => void;
  /** When true, override alert banners are suppressed (rendered externally). */
  hideOverrides?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────

/** Build a map of column -> ordered node indices for Y positioning. */
function columnIndices(nodes: GraphNode[]): Map<string, { col: NodeColumn; idx: number }> {
  const buckets: Record<NodeColumn, GraphNode[]> = { raw: [], stream: [], merge: [], output: [] };
  for (const n of nodes) buckets[n.column].push(n);

  const result = new Map<string, { col: NodeColumn; idx: number }>();
  for (const col of ["raw", "stream", "merge", "output"] as NodeColumn[]) {
    buckets[col].forEach((n, i) => result.set(n.id, { col, idx: i }));
  }
  return result;
}

function nodePos(col: NodeColumn, idx: number): { x: number; y: number } {
  return { x: COL_X[col], y: PADDING_TOP + idx * NODE_SPACING };
}

/** Compute SVG height to fit all nodes. */
function svgHeight(nodes: GraphNode[]): number {
  const buckets: Record<NodeColumn, number> = { raw: 0, stream: 0, merge: 0, output: 0 };
  for (const n of nodes) buckets[n.column]++;
  const maxRows = Math.max(...Object.values(buckets), 1);
  return PADDING_TOP + maxRows * NODE_SPACING + 12;
}

// ── Component ─────────────────────────────────────────────────

export function ComputationGraphView({
  graph,
  shadowGraph,
  sliderValue,
  onSliderChange,
  hideOverrides,
}: ComputationGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Node position lookup
  const layout = columnIndices(graph.nodes);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const shadowNodeMap = shadowGraph
    ? new Map(shadowGraph.nodes.map((n) => [n.id, n]))
    : null;

  const height = svgHeight(graph.nodes);

  // ── Tooltip handlers ──────────────────────────────────

  const svgToContainer = useCallback(
    (sx: number, sy: number): { cx: number; cy: number } => {
      if (!svgRef.current || !containerRef.current) return { cx: sx, cy: sy };
      const svgRect = svgRef.current.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const scaleX = svgRect.width / SVG_WIDTH;
      const scaleY = svgRect.height / height;
      return {
        cx: svgRect.left - containerRect.left + sx * scaleX,
        cy: svgRect.top - containerRect.top + sy * scaleY,
      };
    },
    [height],
  );

  const handleNodeEnter = useCallback(
    (nodeId: string, rect: { x: number; y: number; w: number; h: number }) => {
      // Clear any pending timer
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

      hoverTimerRef.current = setTimeout(() => {
        const { cx, cy } = svgToContainer(rect.x + rect.w / 2, rect.y);
        setTooltip((prev) =>
          prev?.nodeId === nodeId && prev.depth === "deep"
            ? prev // don't downgrade from deep
            : { nodeId, depth: "quick", x: cx, y: cy - 6 },
        );
      }, 500);
    },
    [svgToContainer],
  );

  const handleNodeLeave = useCallback(
    (_nodeId: string) => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      setTooltip((prev) => (prev?.depth === "deep" ? prev : null));
    },
    [],
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      setTooltip((prev) => {
        if (prev?.nodeId === nodeId && prev.depth === "deep") return null; // toggle off
        const info = layout.get(nodeId);
        if (!info) return null;
        const pos = nodePos(info.col, info.idx);
        const { cx, cy } = svgToContainer(pos.x + NODE_W / 2, pos.y);
        return { nodeId, depth: "deep", x: cx, y: cy - 6 };
      });
    },
    [layout, svgToContainer],
  );

  // ── Triggered overrides ───────────────────────────────

  const activeOverrides = graph.overrides.filter((o) => o.triggered);

  // ── Render ────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative w-full space-y-3">
      {/* Override alert banners (suppressed when rendered externally) */}
      {!hideOverrides && activeOverrides.map((ov) => (
        <div
          key={ov.rule}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
          style={{
            backgroundColor:
              ov.severity === "red"
                ? "oklch(30% 0.08 25 / 0.3)"
                : "oklch(40% 0.1 85 / 0.25)",
            borderColor:
              ov.severity === "red"
                ? "oklch(55% 0.2 25 / 0.5)"
                : "oklch(70% 0.15 85 / 0.5)",
            color:
              ov.severity === "red"
                ? "oklch(80% 0.12 25)"
                : "oklch(85% 0.12 85)",
          }}
        >
          {ov.severity === "red" ? (
            <ShieldAlert className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>{ov.message}</span>
        </div>
      ))}

      {/* SVG graph */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${height}`}
        className="w-full"
        style={{ maxHeight: height * 1.2 }}
      >
        {/* Column headers */}
        {(["raw", "stream", "merge", "output"] as NodeColumn[]).map((col) => (
          <text
            key={col}
            x={COL_X[col] + NODE_W / 2}
            y={12}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}
          >
            {COL_LABELS[col]}
          </text>
        ))}

        {/* Edges (bezier curves) */}
        {graph.edges.map((edge) => {
          const fromInfo = layout.get(edge.from);
          const toInfo = layout.get(edge.to);
          if (!fromInfo || !toInfo) return null;
          const from = nodePos(fromInfo.col, fromInfo.idx);
          const to = nodePos(toInfo.col, toInfo.idx);

          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          const dx = (x2 - x1) * BEZIER_OFFSET;

          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="oklch(60% 0 0)"
              strokeWidth={Math.max(0.5, edge.weight * 2)}
              strokeOpacity={0.3 + edge.weight * 0.4}
            />
          );
        })}

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const info = layout.get(node.id);
          if (!info) return null;
          const pos = nodePos(info.col, info.idx);
          const shadowNode = shadowNodeMap?.get(node.id);
          const sv =
            shadowNode && shadowNode.value !== node.value
              ? shadowNode.value
              : undefined;

          return (
            <GraphNodeComponent
              key={node.id}
              node={node}
              x={pos.x}
              y={pos.y}
              isDraggable={node.id === "slider_factor"}
              shadowValue={sv}
              onMouseEnter={handleNodeEnter}
              onMouseLeave={handleNodeLeave}
              onClick={handleNodeClick}
            />
          );
        })}
      </svg>

      {/* Tooltip overlay (HTML on top of SVG) */}
      {tooltip && nodeMap.has(tooltip.nodeId) && (
        <GraphTooltip
          node={nodeMap.get(tooltip.nodeId)!}
          depth={tooltip.depth}
          x={tooltip.x}
          y={tooltip.y}
        />
      )}

      {/* Delta Simulator — the primary interactive control */}
      <div className="mt-4 px-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">Training Intensity</span>
          <span className="text-sm font-mono font-bold tabular-nums">
            {sliderValue === 1.0 ? "Optimal" : sliderValue < 1.0 ? `${((1 - sliderValue) * 100).toFixed(0)}% easier` : `${((sliderValue - 1) * 100).toFixed(0)}% harder`}
          </span>
        </div>
        <div className="relative">
          <div className="absolute inset-0 h-3 rounded-full bg-gradient-to-r from-emerald-500/30 via-amber-500/30 to-red-500/30 pointer-events-none" />
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={sliderValue}
            onChange={(e) => onSliderChange(parseFloat(e.target.value))}
            className="relative w-full h-3 appearance-none bg-transparent cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2
              [&::-webkit-slider-thumb]:border-zinc-400 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab"
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>Conservative</span>
          <span className="font-medium">Optimal</span>
          <span>Push</span>
        </div>
      </div>
    </div>
  );
}
