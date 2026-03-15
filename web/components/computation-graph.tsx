"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw, ShieldAlert } from "lucide-react";
import type { ComputationGraph, GraphNode, GraphEdge, NodeColumn } from "@/lib/training-engine";
import { GraphNodeComponent, NODE_W, NODE_H } from "@/components/graph-node";
import { GraphTooltip } from "@/components/graph-tooltip";


// ── Layout constants ──────────────────────────────────────────

const COL_X: Record<NodeColumn, number> = {
  raw: 0,
  zscore: 220,
  pmc: 490,
  merge: 710,
  output: 1000,
};

const COL_LABELS: Record<NodeColumn, string> = {
  raw: "Signals",
  zscore: "Standardized",
  pmc: "Load Model",
  merge: "Adjustment",
  output: "Output",
};

const PADDING_TOP = 40;
const NODE_SPACING = 58;
const SVG_WIDTH = 1140;

/** Hand-tuned default node positions (5-layer layout, full-width). */
const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = {
  // Layer 1: Raw signals (x = 0)
  hrv_raw:    { x: 0, y: 35 },
  sleep_raw:  { x: 0, y: 98 },
  rhr_raw:    { x: 0, y: 161 },
  bb_raw:     { x: 0, y: 224 },
  epoc_raw:   { x: 0, y: 313 },
  weight_raw: { x: 0, y: 416 },

  // Layer 2: Standardized / streams (x = 220)
  hrv_z:      { x: 220, y: 30 },
  sleep_z:    { x: 220, y: 89 },
  rhr_z:      { x: 220, y: 148 },
  bb_z:       { x: 220, y: 207 },
  atl:        { x: 220, y: 268 },
  ctl:        { x: 220, y: 326 },
  weight_ema: { x: 220, y: 410 },

  // Layer 3: Factors (x = 490)
  readiness_factor: { x: 490, y: 69 },
  slider_factor:    { x: 490, y: 149 },
  tsb:              { x: 490, y: 230 },
  vdot:             { x: 490, y: 313 },
  weight_factor:    { x: 490, y: 383 },

  // Layer 4: Fatigue (x = 710)
  fatigue_factor: { x: 710, y: 234 },

  // Layer 5: Output (x = 1000)
  adjusted_pace: { x: 1000, y: 244 },
};

/** Visual layer headers aligned with DEFAULT_POSITIONS. */
const LAYER_HEADERS = [
  { label: "Signals", x: 0 },
  { label: "Streams", x: 220 },
  { label: "Factors", x: 490 },
  { label: "Fatigue", x: 710 },
  { label: "Output", x: 1000 },
] as const;
const BEZIER_OFFSET = 0.4;

/** Stagger delays (ms) per column for cascade wave effect on slider changes */
const COLUMN_DELAYS: Record<NodeColumn, number> = {
  raw: 0,
  zscore: 50,
  pmc: 100,
  merge: 150,
  output: 200,
};

// ── Drag / persistence ────────────────────────────────────────

const STORAGE_KEY = "soma-dag-positions";

type NodePositions = Record<string, { x: number; y: number }>;

function loadPositions(): NodePositions {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePositions(positions: NodePositions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch { /* quota exceeded — ignore */ }
}

// ── Tooltip state ─────────────────────────────────────────────

interface TooltipState {
  nodeId: string;
  depth: "quick" | "deep";
  x: number;
  y: number;
}

interface EdgeTooltipState {
  edge: GraphEdge;
  fromLabel: string;
  toLabel: string;
  x: number;
  y: number;
}

/** Describe what an edge represents based on source/target columns. */
function edgeDescription(fromNode: GraphNode, toNode: GraphNode): string {
  const descriptions: Record<string, string> = {
    "hrv_z→readiness_composite": "Overnight HRV deviation feeds readiness composite",
    "sleep_z→readiness_composite": "Sleep quality deviation feeds readiness composite",
    "rhr_z→readiness_composite": "Resting HR deviation feeds readiness composite",
    "bb_z→readiness_composite": "Body battery deviation feeds readiness composite",
    "readiness_composite→readiness_factor": "Composite z-score maps to pace multiplier",
    "tsb→fatigue_factor": "Training stress balance maps to fatigue pace multiplier",
    "ctl→tsb": "Chronic load contributes to form (TSB = CTL − ATL)",
    "atl→tsb": "Acute load contributes to form (TSB = CTL − ATL)",
    "weight_ema→weight_factor": "Weight EMA vs calibration weight → pace multiplier",
    "readiness_factor→adjusted_pace": "Readiness adjusts base pace up/down",
    "fatigue_factor→adjusted_pace": "Fatigue adjusts base pace up/down",
    "weight_factor→adjusted_pace": "Weight adjusts base pace up/down",
    "slider_factor→adjusted_pace": "Slider scales the combined adjustment",
    "vdot→adjusted_pace": "VDOT determines base pace via Daniels pace table",
    "ctl→vdot": "Training fitness (Banister model) projects VDOT forward",
    "slider_factor→ctl": "Slider scales training load, shifting chronic load",
    "slider_factor→atl": "Slider scales training load, shifting acute load",
  };
  const key = `${fromNode.id}→${toNode.id}`;
  return descriptions[key] ?? `${fromNode.label} feeds into ${toNode.label}`;
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
  return PADDING_TOP + maxRows * NODE_SPACING + 80;
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

  // Tooltip (node)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tooltip (edge)
  const [edgeTooltip, setEdgeTooltip] = useState<EdgeTooltipState | null>(null);
  const edgeHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Draggable node positions (persisted to localStorage)
  const [customPositions, setCustomPositions] = useState<NodePositions>(loadPositions);
  const hasCustomPositions = Object.keys(customPositions).length > 0;

  // Drag state
  const dragRef = useRef<{
    nodeId: string;
    startSvgX: number;
    startSvgY: number;
    startNodeX: number;
    startNodeY: number;
    didMove: boolean;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Save positions to localStorage when they change
  useEffect(() => {
    savePositions(customPositions);
  }, [customPositions]);

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

  // Add HM time annotation under adjusted_pace — computed from the pace value itself
  const adjustedPaceNode = graph.nodes.find(n => n.id === "adjusted_pace");
  if (adjustedPaceNode?.value != null && adjustedPaceNode.value > 0) {
    const hmSec = adjustedPaceNode.value * 21.0975;
    const h = Math.floor(hmSec / 3600);
    const m = Math.floor((hmSec % 3600) / 60);
    const s = Math.round(hmSec % 60);
    const hmStr = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
    banisterAnnotations.set("adjusted_pace", `HM ≈ ${hmStr}`);
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

  /** Get effective position for a node (custom → hand-tuned default → column fallback). */
  const getNodePos = useCallback(
    (nodeId: string): { x: number; y: number } => {
      if (customPositions[nodeId]) return customPositions[nodeId];
      if (DEFAULT_POSITIONS[nodeId]) return DEFAULT_POSITIONS[nodeId];
      const info = layout.get(nodeId);
      if (!info) return { x: 0, y: 0 };
      return nodePos(info.col, info.idx);
    },
    [customPositions, layout],
  );

  /** Convert client coordinates to SVG coordinates. */
  const clientToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      if (!svgRef.current) return { x: clientX, y: clientY };
      const rect = svgRef.current.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * SVG_WIDTH,
        y: ((clientY - rect.top) / rect.height) * height,
      };
    },
    [height],
  );

  // ── Coordinate conversion ────────────────────────────

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

  // ── Node click handler (needed by drag-or-click logic) ──

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      setTooltip((prev) => {
        if (prev?.nodeId === nodeId && prev.depth === "deep") return null; // toggle off
        const pos = getNodePos(nodeId);
        const { cx, cy } = svgToContainer(pos.x + NODE_W / 2, pos.y);
        return { nodeId, depth: "deep", x: cx, y: cy - 6 };
      });
    },
    [getNodePos, svgToContainer],
  );

  // ── Drag handlers ──────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);

      const svgPt = clientToSvg(e.clientX, e.clientY);
      const info = layout.get(nodeId);
      if (!info) return;
      const currentPos = customPositions[nodeId] ?? nodePos(info.col, info.idx);

      dragRef.current = {
        nodeId,
        startSvgX: svgPt.x,
        startSvgY: svgPt.y,
        startNodeX: currentPos.x,
        startNodeY: currentPos.y,
        didMove: false,
      };
    },
    [clientToSvg, customPositions, layout],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const svgPt = clientToSvg(e.clientX, e.clientY);
      const dx = svgPt.x - drag.startSvgX;
      const dy = svgPt.y - drag.startSvgY;

      // Only start dragging after a small movement threshold (distinguishes click from drag)
      if (!drag.didMove && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

      if (!drag.didMove) {
        drag.didMove = true;
        setIsDragging(true);
        setTooltip(null);
        setEdgeTooltip(null);
      }

      e.preventDefault();
      // Allow nodes to go near the edges (keep at least 10px visible)
      const newX = Math.max(-NODE_W + 10, Math.min(SVG_WIDTH - 10, drag.startNodeX + dx));
      const newY = Math.max(-NODE_H + 10, Math.min(height - 10, drag.startNodeY + dy));

      setCustomPositions((prev) => ({
        ...prev,
        [drag.nodeId]: { x: newX, y: newY },
      }));
    },
    [clientToSvg, height],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);

    // If it was a click (no movement), trigger node click for tooltip
    if (drag && !drag.didMove) {
      handleNodeClick(drag.nodeId);
    }
  }, [handleNodeClick]);

  const handleResetPositions = useCallback(() => {
    setCustomPositions({});
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // ── Edge tooltip handlers ──────────────────────────────

  const handleEdgeEnter = useCallback(
    (edge: GraphEdge, midX: number, midY: number) => {
      if (edgeHoverTimerRef.current) clearTimeout(edgeHoverTimerRef.current);
      edgeHoverTimerRef.current = setTimeout(() => {
        const fromNode = nodeMap.get(edge.from);
        const toNode = nodeMap.get(edge.to);
        if (!fromNode || !toNode) return;
        const { cx, cy } = svgToContainer(midX, midY);
        setEdgeTooltip({
          edge,
          fromLabel: fromNode.label,
          toLabel: toNode.label,
          x: cx,
          y: cy - 6,
        });
      }, 300);
    },
    [nodeMap, svgToContainer],
  );

  const handleEdgeLeave = useCallback(() => {
    if (edgeHoverTimerRef.current) clearTimeout(edgeHoverTimerRef.current);
    setEdgeTooltip(null);
  }, []);

  // ── Node tooltip handlers ─────────────────────────────

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

  // ── Triggered overrides ───────────────────────────────

  const activeOverrides = graph.overrides.filter((o) => o.triggered);

  // ── Render ────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-full space-y-3"
      onClick={(e) => {
        // Close deep tooltips when clicking anywhere outside nodes
        if (e.target === containerRef.current) {
          setTooltip(null);
          setEdgeTooltip(null);
        }
      }}
    >
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

      {/* Date indicator when hovering a historical date — always reserves space to prevent layout shift */}
      <div
        className="flex items-center justify-center gap-1.5 text-xs font-medium mb-1"
        style={{
          color: "oklch(80% 0.15 250)",
          visibility: hoveredDate ? "visible" : "hidden",
        }}
      >
        <span
          className="inline-block w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: "oklch(70% 0.18 250)" }}
        />
        {hoveredDate ? (
          <>
            Viewing:{" "}
            {new Date(hoveredDate + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </>
        ) : (
          "\u00A0" /* non-breaking space to maintain line height */
        )}
      </div>

      {/* SVG graph */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${height}`}
        className="w-full"
        style={{ height: height, touchAction: isDragging ? "none" : "auto" }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => {
          // Close deep tooltip when clicking SVG background (not a node)
          if (e.target === svgRef.current) {
            setTooltip(null);
            setEdgeTooltip(null);
          }
        }}
      >
        {/* Hover scale for graph nodes; hide particles for reduced-motion users */}
        <style>{`
          .graph-node-group:hover {
            transform: scale(1.05);
          }
          .graph-node-group.dragging {
            transform: none !important;
            opacity: 0.85;
          }
          @media (prefers-reduced-motion: reduce) {
            .edge-particle { display: none; }
            .graph-node-group { transition: none !important; }
          }
        `}</style>

        {/* Layer headers aligned with default node positions */}
        {!hasCustomPositions && LAYER_HEADERS.map((layer) => (
          <text
            key={layer.label}
            x={layer.x + NODE_W / 2}
            y={14}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}
          >
            {layer.label}
          </text>
        ))}

        {/* Edges (bezier curves) with animated particles */}
        {displayEdges.map((edge) => {
          const from = getNodePos(edge.from);
          const to = getNodePos(edge.to);
          if (!from || !to) return null;

          // Adaptive connection points: pick the sides that face each other
          const fromCenterX = from.x + NODE_W / 2;
          const toCenterX = to.x + NODE_W / 2;
          const fromCenterY = from.y + NODE_H / 2;
          const toCenterY = to.y + NODE_H / 2;
          const adx = Math.abs(toCenterX - fromCenterX);
          const ady = Math.abs(toCenterY - fromCenterY);

          let x1: number, y1: number, x2: number, y2: number;

          if (adx >= ady) {
            // Primarily horizontal: connect right→left or left→right
            if (fromCenterX <= toCenterX) {
              x1 = from.x + NODE_W; y1 = fromCenterY;
              x2 = to.x; y2 = toCenterY;
            } else {
              x1 = from.x; y1 = fromCenterY;
              x2 = to.x + NODE_W; y2 = toCenterY;
            }
          } else {
            // Primarily vertical: connect bottom→top or top→bottom
            if (fromCenterY <= toCenterY) {
              x1 = fromCenterX; y1 = from.y + NODE_H;
              x2 = toCenterX; y2 = to.y;
            } else {
              x1 = fromCenterX; y1 = from.y;
              x2 = toCenterX; y2 = to.y + NODE_H;
            }
          }

          // Adaptive bezier control points: horizontal or vertical offset
          const dy = (y2 - y1) * BEZIER_OFFSET;
          const dx = (x2 - x1) * BEZIER_OFFSET;
          let pathD: string;
          if (adx >= ady) {
            // Horizontal flow: offset control points in X
            pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          } else {
            // Vertical flow: offset control points in Y
            pathD = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
          }

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

          // Midpoint for tooltip positioning
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          return (
            <g key={`${edge.from}-${edge.to}`}>
              <path
                id={edgeId}
                d={pathD}
                fill="none"
                stroke={edgeColor}
                strokeWidth={Math.max(1.5, absW * 6)}
                style={{ transition: "d 150ms ease, stroke 200ms ease, stroke-width 200ms ease" }}
              />
              {/* Invisible wider hit target for edge hover */}
              <path
                d={pathD}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                style={{ cursor: "help" }}
                onMouseEnter={() => handleEdgeEnter(edge, midX, midY)}
                onMouseLeave={handleEdgeLeave}
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

        {/* Nodes — draggable, cascade timing staggers updates column-by-column */}
        {displayNodes.map((node) => {
          const info = layout.get(node.id);
          if (!info) return null;
          const pos = getNodePos(node.id);
          const shadowNode = shadowNodeMap?.get(node.id);
          const sv =
            shadowNode && shadowNode.value !== node.value
              ? shadowNode.value
              : undefined;
          const isThisDragging = isDragging && dragRef.current?.nodeId === node.id;

          return (
            <g
              key={node.id}
              onPointerDown={(e) => handlePointerDown(e, node.id)}
              style={{ cursor: "grab" }}
            >
              <GraphNodeComponent
                node={node}
                x={pos.x}
                y={pos.y}
                shadowValue={sv}
                cascadeDelay={isThisDragging ? 0 : COLUMN_DELAYS[info.col]}
                onMouseEnter={isDragging ? undefined : handleNodeEnter}
                onMouseLeave={isDragging ? undefined : handleNodeLeave}
              />
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

      {/* Edge tooltip */}
      {edgeTooltip && (
        <div
          className="absolute z-50 pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg px-3 py-2 max-w-xs"
          style={{
            left: edgeTooltip.x,
            top: edgeTooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="text-xs font-medium">
            {edgeTooltip.fromLabel} → {edgeTooltip.toLabel}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {edgeDescription(
              nodeMap.get(edgeTooltip.edge.from)!,
              nodeMap.get(edgeTooltip.edge.to)!,
            )}
          </p>
          <p className="text-[10px] mt-1" style={{
            color: (edgeTooltip.edge.weight ?? 0) >= 0
              ? "oklch(62% 0.17 142)"
              : "oklch(60% 0.22 25)",
          }}>
            Weight: {(edgeTooltip.edge.weight ?? 0) >= 0 ? "+" : ""}{(edgeTooltip.edge.weight ?? 0).toFixed(2)}
            {" · "}
            {Math.abs(edgeTooltip.edge.weight ?? 0) > 0.6 ? "Strong" : Math.abs(edgeTooltip.edge.weight ?? 0) > 0.3 ? "Moderate" : "Weak"} signal
          </p>
        </div>
      )}

      {/* Reset positions button */}
      {hasCustomPositions && (
        <button
          onClick={handleResetPositions}
          className="absolute top-0 right-0 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded"
          title="Reset node positions to default"
        >
          <RotateCcw className="h-3 w-3" />
          Reset layout
        </button>
      )}

    </div>
  );
}
