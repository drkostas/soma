"use client";

import type { GraphNode } from "@/lib/training-engine";
import { DEFAULT_BASE_PACE } from "@/lib/training-engine";
import { PaceWaterfall } from "@/components/pace-waterfall";

export interface GraphTooltipProps {
  node: GraphNode;
  depth: "quick" | "deep";
  x: number;
  y: number;
  /** All graph nodes, keyed by id. Needed for decomposition views. */
  allNodes?: Map<string, GraphNode>;
}

/** Green for faster (negative seconds), red for slower (positive). */
const FASTER_COLOR = "oklch(62% 0.17 142)";
const SLOWER_COLOR = "oklch(60% 0.22 25)";
const NEUTRAL_COLOR = "oklch(0.7 0.05 250)";

function waterfallColor(seconds: number): string {
  if (Math.abs(seconds) < 0.05) return NEUTRAL_COLOR;
  return seconds < 0 ? FASTER_COLOR : SLOWER_COLOR;
}

export function GraphTooltip({ node, depth, x, y, allNodes }: GraphTooltipProps) {
  // Build waterfall data for adjusted_pace deep tooltip
  const showWaterfall =
    depth === "deep" &&
    node.id === "adjusted_pace" &&
    node.value != null &&
    allNodes;

  let waterfallEl: React.ReactNode = null;
  if (showWaterfall) {
    const basePace = DEFAULT_BASE_PACE;
    const rf = allNodes.get("readiness_factor")?.value ?? 1.0;
    const ff = allNodes.get("fatigue_factor")?.value ?? 1.0;
    const wf = allNodes.get("weight_factor")?.value ?? 1.0;
    const sf = allNodes.get("slider_factor")?.value ?? 1.0;

    // Decompose contributions: each factor's individual effect on pace (in seconds)
    // The formula is: adjusted = basePace * (1 + (rf * ff * wf - 1) * slider)
    // We decompose the multiplicative product into additive contributions:
    //   readiness contribution = basePace * (rf - 1)
    //   fatigue contribution = basePace * (ff - 1)
    //   weight contribution = basePace * (wf - 1)
    // Then slider scales the combined delta, so slider contribution is the residual.
    const rfDelta = basePace * (rf - 1.0);
    const ffDelta = basePace * (ff - 1.0);
    const wfDelta = basePace * (wf - 1.0);
    // Combined delta before slider: basePace * (rf * ff * wf - 1)
    const combinedDelta = basePace * (rf * ff * wf - 1.0);
    // Slider scales the delta: final delta = combinedDelta * slider
    // So slider contribution = combinedDelta * (slider - 1)
    const sliderDelta = combinedDelta * (sf - 1.0);

    const items = [
      { label: "Readiness", seconds: rfDelta, color: waterfallColor(rfDelta) },
      { label: "Fatigue", seconds: ffDelta, color: waterfallColor(ffDelta) },
      { label: "Weight", seconds: wfDelta, color: waterfallColor(wfDelta) },
      { label: "Slider", seconds: sliderDelta, color: waterfallColor(sliderDelta) },
    ].filter(i => Math.abs(i.seconds) >= 0.05);

    waterfallEl = (
      <PaceWaterfall
        basePace={basePace}
        items={items}
        adjustedPace={node.value!}
      />
    );
  }

  return (
    <div
      className="absolute z-50 pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-3 max-w-xs"
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -100%)",
      }}
    >
      {/* Quick tooltip: single line */}
      <p className="text-xs leading-relaxed">{node.tooltip.short}</p>

      {/* Deep tooltip: formula + inputs + source */}
      {depth === "deep" && (
        <div className="mt-2 space-y-1.5">
          {node.tooltip.formula && (
            <pre className="text-[10px] font-mono bg-muted/50 rounded px-2 py-1 whitespace-pre-wrap break-words">
              {node.tooltip.formula}
            </pre>
          )}

          {waterfallEl && (
            <div className="mt-2">{waterfallEl}</div>
          )}

          {node.tooltip.inputs && node.tooltip.inputs.length > 0 && (
            <div className="text-[10px] text-muted-foreground">
              <span className="font-medium">Inputs:</span>{" "}
              {node.tooltip.inputs.join(", ")}
            </div>
          )}

          {node.tooltip.source && (
            <p className="text-[10px] italic text-muted-foreground">
              {node.tooltip.source}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
