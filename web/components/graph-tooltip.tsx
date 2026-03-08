"use client";

import type { GraphNode } from "@/lib/training-engine";

export interface GraphTooltipProps {
  node: GraphNode;
  depth: "quick" | "deep";
  x: number;
  y: number;
}

export function GraphTooltip({ node, depth, x, y }: GraphTooltipProps) {
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
