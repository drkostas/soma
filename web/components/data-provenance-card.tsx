"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, ArrowUp, ArrowDown, Minus } from "lucide-react";

interface ProvenanceData {
  hrv_z: number | null;
  sleep_z: number | null;
  rhr_z: number | null;
  bb_z: number | null;
  ctl: number;
  atl: number;
  tsb: number;
  vo2max: number | null;
  weight_kg: number | null;
  decoupling_pct: number | null;
}

function SignalRow({ label, value, unit, zScore }: {
  label: string; value: string; unit?: string; zScore?: number;
}) {
  const direction = zScore === undefined ? "neutral"
    : zScore > 0.5 ? "positive"
    : zScore < -0.5 ? "negative"
    : "neutral";

  const colors = {
    positive: "oklch(62% 0.17 142)",
    neutral: "oklch(65% 0.15 250)",
    negative: "oklch(60% 0.22 25)",
  };
  const Icon = direction === "positive" ? ArrowUp : direction === "negative" ? ArrowDown : Minus;

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium tabular-nums">{value}{unit && ` ${unit}`}</span>
        {zScore !== undefined && (
          <Icon className="h-3 w-3" style={{ color: colors[direction] }} />
        )}
      </div>
    </div>
  );
}

export function DataProvenanceCard({ data }: { data: ProvenanceData | null }) {
  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Database className="h-4 w-4" />
            Data Streams
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground text-sm py-4">
          No data available
        </CardContent>
      </Card>
    );
  }

  const fmtZ = (v: number | null) => v === null ? "N/A" : (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Database className="h-4 w-4" style={{ color: "oklch(65% 0.15 250)" }} />
          Signal Status
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border/50">
        <div className="pb-1.5">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">Readiness</div>
          <SignalRow label="HRV" value={fmtZ(data.hrv_z)} unit={data.hrv_z !== null ? "z" : undefined} zScore={data.hrv_z ?? undefined} />
          <SignalRow label="Sleep" value={fmtZ(data.sleep_z)} unit={data.sleep_z !== null ? "z" : undefined} zScore={data.sleep_z ?? undefined} />
          <SignalRow label="RHR" value={fmtZ(data.rhr_z)} unit={data.rhr_z !== null ? "z" : undefined} zScore={data.rhr_z ?? undefined} />
          <SignalRow label="Body Battery" value={fmtZ(data.bb_z)} unit={data.bb_z !== null ? "z" : undefined} zScore={data.bb_z ?? undefined} />
        </div>
        <div className="pt-1.5 pb-1.5">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">Load</div>
          <SignalRow label="Fitness (CTL)" value={data.ctl.toFixed(0)} />
          <SignalRow label="Fatigue (ATL)" value={data.atl.toFixed(0)} />
          <SignalRow label="Form (TSB)" value={data.tsb >= 0 ? `+${data.tsb.toFixed(0)}` : data.tsb.toFixed(0)} zScore={data.tsb > 0 ? 1 : data.tsb < -15 ? -1 : 0} />
        </div>
        <div className="pt-1.5">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">Fitness</div>
          {data.vo2max != null && <SignalRow label="VO2max" value={Number(data.vo2max).toFixed(1)} />}
          {data.weight_kg != null && <SignalRow label="Weight" value={Number(data.weight_kg).toFixed(1)} unit="kg" />}
          {data.decoupling_pct != null && (
            <SignalRow label="Decoupling" value={`${Number(data.decoupling_pct).toFixed(1)}%`} zScore={Number(data.decoupling_pct) < 3 ? 1 : Number(data.decoupling_pct) > 5 ? -1 : 0} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
