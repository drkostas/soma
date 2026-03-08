"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Activity } from "lucide-react";

interface ReadinessData {
  composite_score: number;
  traffic_light: string;
  hrv_z_score: number | null;
  sleep_z_score: number | null;
  rhr_z_score: number | null;
  body_battery_z_score: number | null;
  flags: string[];
}

const lightColors: Record<string, string> = {
  green: "oklch(62% 0.17 142)",
  yellow: "oklch(80% 0.18 87)",
  red: "oklch(60% 0.22 25)",
};

function ZBar({ label, value }: { label: string; value: number | null }) {
  if (value === null || value === undefined) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground w-[32px] text-right shrink-0">
          {label}
        </span>
        <div className="flex-1 h-2 bg-muted/50 rounded-full relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-muted-foreground/30" />
        </div>
        <span className="text-[10px] text-muted-foreground/50 w-[28px] tabular-nums">
          —
        </span>
      </div>
    );
  }

  const clamped = Math.max(-3, Math.min(3, value));
  const pct = ((clamped + 3) / 6) * 100;
  const color =
    value >= 0.5
      ? "oklch(62% 0.17 142)"
      : value >= -0.5
        ? "oklch(65% 0.15 250)"
        : value >= -1.0
          ? "oklch(80% 0.18 87)"
          : "oklch(60% 0.22 25)";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-[32px] text-right shrink-0">
        {label}
      </span>
      <div className="flex-1 h-2 bg-muted/50 rounded-full relative">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-muted-foreground/30" />
        <div
          className="absolute top-0 bottom-0 rounded-full transition-all"
          style={{
            left: value >= 0 ? "50%" : `${pct}%`,
            width: value >= 0 ? `${pct - 50}%` : `${50 - pct}%`,
            backgroundColor: color,
            opacity: 0.7,
          }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground w-[28px] tabular-nums">
        {value >= 0 ? "+" : ""}
        {value.toFixed(1)}
      </span>
    </div>
  );
}

export function ReadinessCard({ data }: { data: ReadinessData | null }) {
  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <span className="text-sm font-medium text-muted-foreground">Readiness</span>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground text-sm py-6">
          No readiness data
        </CardContent>
      </Card>
    );
  }

  const color = lightColors[data.traffic_light] || lightColors.green;
  const flags = typeof data.flags === "string" ? JSON.parse(data.flags) : data.flags || [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Activity className="h-4 w-4" style={{ color }} />
          Today&apos;s Readiness
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-3">
          <div
            className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center"
            style={{ backgroundColor: color }}
          >
            <span className="text-xs font-bold text-white uppercase">
              {data.traffic_light === "green" ? "GO" : data.traffic_light === "yellow" ? "EZ" : "X"}
            </span>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {data.composite_score >= 0 ? "+" : ""}
              {Number(data.composite_score).toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground capitalize">
              {data.traffic_light} — {data.traffic_light === "green" ? "train as planned" : data.traffic_light === "yellow" ? "reduce intensity" : "rest or easy only"}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <ZBar label="HRV" value={data.hrv_z_score != null ? Number(data.hrv_z_score) : null} />
          <ZBar label="Sleep" value={data.sleep_z_score != null ? Number(data.sleep_z_score) : null} />
          <ZBar label="RHR" value={data.rhr_z_score != null ? Number(data.rhr_z_score) : null} />
          <ZBar label="BB" value={data.body_battery_z_score != null ? Number(data.body_battery_z_score) : null} />
        </div>

        {flags.length > 0 && flags[0] !== "no_data" && (
          <div className="mt-2 flex flex-wrap gap-1">
            {flags.map((f: string) => (
              <span
                key={f}
                className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {f.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
