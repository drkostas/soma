"use client";

import { useEffect, useState } from "react";
import { Brain, FlaskConical, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ── Types ───────────────────────────────────────────────────

interface BanisterData {
  p0: number;
  k1: number;
  k2: number;
  tau1: number;
  tau2: number;
  anchorCount: number;
  fittedAt: string | null;
  isDefault: boolean;
}

interface CalibrationData {
  phase: number;
  phaseName: string;
  dataDays: number;
  weights: Record<string, number>;
  forceEqual: boolean;
  updatedAt: string | null;
  isDefault: boolean;
}

interface ModelParamsResponse {
  model: {
    name: string;
    fullName: string;
    description: string;
  };
  banister: BanisterData;
  calibration: CalibrationData;
}

// ── Helpers ─────────────────────────────────────────────────

const WEIGHT_LABELS: Record<string, string> = {
  hrv: "HRV",
  sleep: "Sleep",
  rhr: "RHR",
  bb: "Body Bat.",
};

const WEIGHT_COLORS: Record<string, string> = {
  hrv: "oklch(0.7 0.15 250)",
  sleep: "oklch(0.7 0.15 290)",
  rhr: "oklch(0.7 0.15 25)",
  bb: "oklch(0.7 0.15 142)",
};

function ParamChip({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-baseline gap-1 rounded px-1.5 py-0.5 text-[11px] bg-muted/50 cursor-help"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </span>
  );
}

// ── Component ───────────────────────────────────────────────

export function ModelParamsPanel() {
  const [data, setData] = useState<ModelParamsResponse | null>(null);
  const [error, setError] = useState(false);
  const [forceEqual, setForceEqual] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchParams() {
      try {
        const res = await fetch("/api/training/model-params");
        if (!res.ok) throw new Error("fetch failed");
        const json: ModelParamsResponse = await res.json();
        if (!cancelled) {
          setData(json);
          setForceEqual(json.calibration.forceEqual);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    fetchParams();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null; // silent degradation
  if (!data) {
    return (
      <div className="flex items-center justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { model, banister, calibration } = data;
  const weights = calibration.weights;
  const maxWeight = Math.max(...Object.values(weights), 0.01);

  return (
    <div className="space-y-3 text-xs">
      {/* Model identity */}
      <div className="flex items-center gap-2">
        <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium" title={model.description}>
          {model.fullName}
        </span>
        {banister.isDefault && (
          <span
            className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-500 font-medium"
            title="Using default parameters — no fitted data yet"
          >
            defaults
          </span>
        )}
      </div>

      {/* Banister parameters */}
      <div className="flex flex-wrap gap-1.5">
        <ParamChip
          label={"\u03C4\u2081 fitness"}
          value={`${Math.round(banister.tau1)}d`}
          title={`Fitness decay time constant: ${banister.tau1.toFixed(1)} days. How long positive training adaptations persist. Higher = longer lasting fitness gains.`}
        />
        <ParamChip
          label={"\u03C4\u2082 fatigue"}
          value={`${Math.round(banister.tau2)}d`}
          title={`Fatigue decay time constant: ${banister.tau2.toFixed(1)} days. How quickly fatigue dissipates after hard training. Lower = faster recovery.`}
        />
        <ParamChip
          label="k\u2081"
          value={banister.k1.toFixed(3)}
          title={`Fitness gain coefficient: ${banister.k1.toFixed(4)}. Scales how much each unit of training load contributes to fitness. Higher = more responsive to training.`}
        />
        <ParamChip
          label="k\u2082"
          value={banister.k2.toFixed(3)}
          title={`Fatigue gain coefficient: ${banister.k2.toFixed(4)}. Scales how much each unit of training load contributes to fatigue. Higher = more sensitive to overload.`}
        />
        <ParamChip
          label="p\u2080 VDOT"
          value={banister.p0.toFixed(1)}
          title={`Baseline VDOT: ${banister.p0.toFixed(2)}. The starting performance level before any training effect is applied.`}
        />
        <ParamChip
          label="anchors"
          value={String(banister.anchorCount)}
          title={`Number of maximal-effort anchor runs used for model fitting. More anchors = more reliable parameter estimates. Anchor runs require avg HR >= 90% of HRmax and distance >= 2km.`}
        />
      </div>

      {/* Calibration phase + weights */}
      <div className="flex items-start gap-2">
        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-medium"
              title={`Calibration progresses through 4 phases as data accumulates: Phase 1 (<30d) equal weights, Phase 2 (30d+) correlation-based, Phase 3 (60d+) LASSO regression, Phase 4 (120d+) Kalman filter.`}
            >
              Phase {calibration.phase}/4
            </span>
            <span className="text-muted-foreground">{calibration.phaseName}</span>
            <span className="text-muted-foreground/70">
              {"\u00B7"} {calibration.dataDays}d data
            </span>
          </div>

          {/* Equal / Personal weights toggle */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              {forceEqual ? "Equal Weights (Dawes 1979)" : "Personal Weights"}
            </span>
            <Switch
              checked={!forceEqual}
              onCheckedChange={(checked) => {
                const newForceEqual = !checked;
                setForceEqual(newForceEqual);
                fetch("/api/training/calibration/toggle", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ forceEqual: newForceEqual }),
                });
              }}
            />
          </div>

          {/* Weight bars */}
          <div className="flex gap-2 flex-wrap">
            {Object.entries(weights).map(([key, weight]) => {
              const displayWeight = forceEqual ? 0.25 : weight;
              const displayMax = forceEqual ? 0.25 : maxWeight;
              return (
                <div
                  key={key}
                  className="flex items-center gap-1"
                  title={`${WEIGHT_LABELS[key] ?? key} weight: ${(displayWeight * 100).toFixed(0)}%. Controls how much this biometric signal influences the composite readiness score.`}
                >
                  <div
                    className="h-2 rounded-sm"
                    style={{
                      width: `${Math.max(16, (displayWeight / displayMax) * 48)}px`,
                      backgroundColor: WEIGHT_COLORS[key] ?? "oklch(0.6 0.05 250)",
                      opacity: forceEqual ? 0.7 : 0.4 + 0.6 * (weight / maxWeight),
                    }}
                  />
                  <span className="text-muted-foreground text-[10px]">
                    {WEIGHT_LABELS[key] ?? key}{" "}
                    {forceEqual
                      ? "25%"
                      : `${(weight * 100).toFixed(0)}%`}
                    {!forceEqual && (
                      <span className="opacity-50 ml-0.5">
                        |r|
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
