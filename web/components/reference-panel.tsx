"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkline } from "./sparkline";

export interface ReferenceMetric {
  id: string;
  label: string;
  value: string;
  sparkline: number[];
  color: string;
  tooltip: string;
  comparison?: { ours: string; garmin: string };
  thresholds?: { label: string; color: string }[];
}

interface ReferencePanelProps {
  metrics: ReferenceMetric[];
}

export function ReferencePanel({ metrics }: ReferencePanelProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        External Comparison Signals
        <span className="ml-2 text-xs opacity-60">&mdash; not part of the model, shown for reference</span>
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {metrics.map((metric) => (
        <Card
          key={metric.id}
          className="relative"
          onMouseEnter={() => setHoveredId(metric.id)}
          onMouseLeave={() => setHoveredId(null)}
        >
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground mb-1">
              {metric.label}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium font-mono">
                {metric.value}
              </span>
              <Sparkline
                data={metric.sparkline}
                color={metric.color}
                width={60}
                height={20}
              />
            </div>
            {metric.comparison && (
              <div className="text-[9px] text-muted-foreground mt-1">
                Ours: {metric.comparison.ours} | Garmin:{" "}
                {metric.comparison.garmin}
              </div>
            )}
            {metric.thresholds && metric.thresholds.length > 0 && (
              <div className="flex gap-1 mt-1">
                {metric.thresholds.map((t) => (
                  <span
                    key={t.label}
                    className="text-[8px] px-1 rounded"
                    style={{
                      backgroundColor: t.color + "20",
                      color: t.color,
                    }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
          {hoveredId === metric.id && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-popover border rounded-lg shadow-lg p-2 max-w-[200px] text-[10px] z-50">
              {metric.tooltip}
            </div>
          )}
        </Card>
      ))}
      </div>
    </div>
  );
}
