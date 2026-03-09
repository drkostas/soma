"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { ComputationGraph, GraphNode, NodeColumn } from "@/lib/training-engine";
import { GraphNodeComponent, NODE_W, NODE_H } from "@/components/graph-node";
import { GraphTooltip } from "@/components/graph-tooltip";

// ── Layout constants ──────────────────────────────────────────

const COL_X: Record<NodeColumn, number> = {
  raw: 10,
  zscore: 175,
  pmc: 340,
  merge: 505,
  output: 670,
};

const COL_LABELS: Record<NodeColumn, string> = {
  raw: "Signals",
  zscore: "Standardized",
  pmc: "Load Model",
  merge: "Adjustment",
  output: "Output",
};

const PADDING_TOP = 28;
const NODE_SPACING = 62;
const SVG_WIDTH = 820;
const BEZIER_OFFSET = 0.4;

/** Stagger delays (ms) per column for cascade wave effect on slider changes */
const COLUMN_DELAYS: Record<NodeColumn, number> = {
  raw: 0,
  zscore: 50,
  pmc: 100,
  merge: 150,
  output: 200,
};

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
  /** When set, shows a date indicator and the graph displays that date's values. */
  hoveredDate?: string | null;
  /** When true, override alert banners are suppressed (rendered externally). */
  hideOverrides?: boolean;
  calibration?: { phase: number; dataDays: number; weights: Record<string, number>; forceEqual: boolean } | null;
}

// ── Helpers ───────────────────────────────────────────────────

/** Build a map of column -> ordered node indices for Y positioning. */
function columnIndices(nodes: GraphNode[]): Map<string, { col: NodeColumn; idx: number }> {
  const buckets: Record<NodeColumn, GraphNode[]> = { raw: [], zscore: [], pmc: [], merge: [], output: [] };
  for (const n of nodes) buckets[n.column].push(n);

  const result = new Map<string, { col: NodeColumn; idx: number }>();
  for (const col of ["raw", "zscore", "pmc", "merge", "output"] as NodeColumn[]) {
    buckets[col].forEach((n, i) => result.set(n.id, { col, idx: i }));
  }
  return result;
}

function nodePos(col: NodeColumn, idx: number): { x: number; y: number } {
  return { x: COL_X[col], y: PADDING_TOP + idx * NODE_SPACING };
}

/** Compute SVG height to fit all nodes. */
function svgHeight(nodes: GraphNode[]): number {
  const buckets: Record<NodeColumn, number> = { raw: 0, zscore: 0, pmc: 0, merge: 0, output: 0 };
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
  hoveredDate,
  hideOverrides,
  calibration,
}: ComputationGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Banister params to fold into annotations rather than separate nodes
  const BANISTER_PARAM_IDS = new Set(["banister_tau1", "banister_tau2", "banister_p0", "banister_k1", "banister_k2"]);
  const banisterAnnotations = new Map<string, string>();

  for (const node of graph.nodes) {
    if (node.id === "banister_tau1" && node.value != null) {
      banisterAnnotations.set("ctl", `τ₁=${Math.round(node.value)}d`);
    }
    if (node.id === "banister_tau2" && node.value != null) {
      banisterAnnotations.set("atl", `τ₂=${Math.round(node.value)}d`);
    }
    if (node.id === "banister_p0" && node.value != null) {
      banisterAnnotations.set("vdot", `p₀=${node.value.toFixed(1)}`);
    }
  }

  // Filter out banister param nodes and edges from display
  const displayNodes = graph.nodes.filter(n => !BANISTER_PARAM_IDS.has(n.id));
  const displayEdges = graph.edges.filter(
    e => !BANISTER_PARAM_IDS.has(e.from) && !BANISTER_PARAM_IDS.has(e.to)
  );

  // Node position lookup
  const layout = columnIndices(displayNodes);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const shadowNodeMap = shadowGraph
    ? new Map(shadowGraph.nodes.map((n) => [n.id, n]))
    : null;

  const height = svgHeight(displayNodes);

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
      {/* Model header — replaces model-params-panel */}
      <div className="flex items-center justify-between px-1 pb-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          Banister IR + Composite Readiness
        </span>
        {calibration && (
          <span>
            Phase {calibration.phase}/4 · {calibration.dataDays}d data ·{" "}
            {calibration.forceEqual ? "Equal weights" : "Personal weights"}
          </span>
        )}
      </div>

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

      {/* Date indicator when hovering a historical date */}
      {hoveredDate && (
        <div
          className="flex items-center justify-center gap-1.5 text-xs font-medium mb-1"
          style={{
            color: "oklch(80% 0.15 250)",
          }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ backgroundColor: "oklch(70% 0.18 250)" }}
          />
          Viewing:{" "}
          {new Date(hoveredDate + "T00:00:00").toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </div>
      )}

      {/* SVG graph */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${height}`}
        className="w-full"
        style={{ maxHeight: height * 1.2 }}
      >
        {/* Hover scale for graph nodes; hide particles for reduced-motion users */}
        <style>{`
          .graph-node-group:hover {
            transform: scale(1.05);
          }
          @media (prefers-reduced-motion: reduce) {
            .edge-particle { display: none; }
            .graph-node-group { transition: none !important; }
          }
        `}</style>

        {/* Column headers */}
        {(["raw", "zscore", "pmc", "merge", "output"] as NodeColumn[]).map((col) => (
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

        {/* Edges (bezier curves) with animated particles */}
        {displayEdges.map((edge) => {
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

          // Color edges by contribution direction: green = helping, red = hurting
          const w = edge.weight ?? 0;
          const absW = Math.max(0.15, Math.abs(w));
          const edgeColor = w >= 0
            ? `oklch(62% 0.17 142 / ${0.3 + absW * 0.5})`   // green = positive contribution
            : `oklch(60% 0.22 25 / ${0.3 + absW * 0.5})`;   // red = negative contribution

          // Particle dot color (slightly more opaque than the edge)
          const dotColor = w >= 0
            ? `oklch(62% 0.17 142 / ${0.5 + absW * 0.4})`
            : `oklch(60% 0.22 25 / ${0.5 + absW * 0.4})`;

          // Speed inversely proportional to weight — stronger signals flow faster
          const dur = `${1.5 / Math.max(0.1, absW)}s`;

          const edgeId = `edge-${edge.from}-${edge.to}`;
          const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

          return (
            <g key={`${edge.from}-${edge.to}`}>
              <path
                id={edgeId}
                d={pathD}
                fill="none"
                stroke={edgeColor}
                strokeWidth={Math.max(1.5, absW * 6)}
                style={{ transition: "stroke 200ms ease, stroke-width 200ms ease" }}
              />
              {/* Animated particle flowing along the edge */}
              <circle
                r={Math.max(2, absW * 4)}
                fill={dotColor}
                className="edge-particle"
              >
                <animateMotion dur={dur} repeatCount="indefinite">
                  <mpath href={`#${edgeId}`} />
                </animateMotion>
              </circle>
            </g>
          );
        })}

        {/* Nodes — cascade timing staggers updates column-by-column */}
        {displayNodes.map((node) => {
          const info = layout.get(node.id);
          if (!info) return null;
          const pos = nodePos(info.col, info.idx);
          const shadowNode = shadowNodeMap?.get(node.id);
          const sv =
            shadowNode && shadowNode.value !== node.value
              ? shadowNode.value
              : undefined;

          return (
            <g key={node.id}>
              {node.id === "slider_factor" ? (
                <foreignObject x={pos.x - 20} y={pos.y} width={180} height={64}>
                  <div className="flex flex-col items-center justify-center h-full rounded-lg border border-border/50" style={{ backgroundColor: "oklch(25% 0.02 250 / 0.8)" }}>
                    <span className="text-[10px] text-muted-foreground mb-0.5">Training Intensity</span>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={sliderValue}
                      onChange={(e) => onSliderChange(parseFloat(e.target.value))}
                      className="w-[140px] h-2 appearance-none bg-gradient-to-r from-emerald-500/40 via-amber-500/40 to-red-500/40 rounded-full cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2
                        [&::-webkit-slider-thumb]:border-zinc-400 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab"
                    />
                    <span className="text-[9px] font-mono text-foreground mt-0.5">
                      {sliderValue === 1.0 ? "Optimal" : sliderValue < 1.0 ? `${((1 - sliderValue) * 100).toFixed(0)}% easier` : `${((sliderValue - 1) * 100).toFixed(0)}% harder`}
                    </span>
                  </div>
                </foreignObject>
              ) : (
                <GraphNodeComponent
                  node={node}
                  x={pos.x}
                  y={pos.y}
                  shadowValue={sv}
                  cascadeDelay={COLUMN_DELAYS[info.col]}
                  onMouseEnter={handleNodeEnter}
                  onMouseLeave={handleNodeLeave}
                  onClick={handleNodeClick}
                />
              )}
              {banisterAnnotations.has(node.id) && (
                <text
                  x={pos.x + NODE_W / 2}
                  y={pos.y + NODE_H + 12}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  style={{ fontSize: 9, fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
                >
                  {banisterAnnotations.get(node.id)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Empty state overlay when ALL nodes have null values */}
      {displayNodes.every(n => n.value === null) && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/80 rounded-lg">
          <div className="text-center text-muted-foreground">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No data available yet</p>
            <p className="text-xs mt-1">Run the training engine pipeline to populate signals</p>
          </div>
        </div>
      )}

      {/* Tooltip overlay (HTML on top of SVG) */}
      {tooltip && nodeMap.has(tooltip.nodeId) && (
        <GraphTooltip
          node={nodeMap.get(tooltip.nodeId)!}
          depth={tooltip.depth}
          x={tooltip.x}
          y={tooltip.y}
          allNodes={nodeMap}
        />
      )}

    </div>
  );
}
