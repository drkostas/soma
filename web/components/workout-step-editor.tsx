"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface WorkoutStep {
  name?: string;
  type: string;
  target_pace?: number;
  target_pace_low?: number;
  target_pace_high?: number;
  target_hr_low?: number;
  target_hr_high?: number;
  distance_meters?: number;
  duration_minutes?: number;
  repeats?: number;
}

interface WorkoutStepEditorProps {
  steps: WorkoutStep[];
  editable?: boolean;
  onStepsChange?: (steps: WorkoutStep[]) => void;
  isDelta?: boolean;
}

const stepBorderColors: Record<string, string> = {
  warmup: "border-l-blue-400",
  warm_up: "border-l-blue-400",
  work: "border-l-orange-400",
  interval: "border-l-orange-400",
  recovery: "border-l-green-400",
  rest: "border-l-green-400",
  cooldown: "border-l-blue-400",
  cool_down: "border-l-blue-400",
};

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parsePace(str: string): number | null {
  const parts = str.split(":");
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s)) return null;
  return m * 60 + s;
}

function InlineEdit({
  value,
  onSave,
  format,
  parse,
  className,
  editable,
}: {
  value: string;
  onSave: (val: string) => void;
  format?: (v: string) => string;
  parse?: (v: string) => string | null;
  className?: string;
  editable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(() => {
    const parsed = parse ? parse(draft) : draft;
    if (parsed !== null) {
      onSave(parsed);
    }
    setEditing(false);
  }, [draft, onSave, parse]);

  if (!editable) {
    return <span className={className}>{format ? format(value) : value}</span>;
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={cn(
          "bg-transparent border-b border-muted-foreground/40 outline-none text-inherit w-16 font-mono",
          className,
        )}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
      />
    );
  }

  return (
    <button
      className={cn(
        "cursor-pointer border-b border-dashed border-muted-foreground/30 hover:border-muted-foreground/60 transition-colors",
        className,
      )}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {format ? format(value) : value}
    </button>
  );
}

export function WorkoutStepEditor({
  steps,
  editable = false,
  onStepsChange,
  isDelta = false,
}: WorkoutStepEditorProps) {
  function updateStep(index: number, patch: Partial<WorkoutStep>) {
    if (!onStepsChange) return;
    const updated = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onStepsChange(updated);
  }

  if (!steps || steps.length === 0) return null;

  return (
    <div
      className={cn(
        "mt-1.5 space-y-1 rounded-md",
        isDelta && "bg-yellow-500/10 ring-1 ring-yellow-500/20 p-1.5",
      )}
    >
      {steps.map((step, i) => {
        const borderColor =
          stepBorderColors[step.type?.toLowerCase()] ||
          "border-l-muted-foreground/40";

        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 text-[10px] text-muted-foreground/70 pl-2 py-0.5 border-l-2 rounded-sm",
              borderColor,
            )}
          >
            <span className="font-medium text-muted-foreground/90 capitalize min-w-[52px]">
              {step.name || step.type}
            </span>

            {/* Pace range */}
            {(step.target_pace || step.target_pace_low) && (
              <span className="font-mono">
                @{" "}
                {step.target_pace_low && step.target_pace_high ? (
                  <>
                    <InlineEdit
                      value={String(step.target_pace_low)}
                      editable={editable}
                      format={(v) => formatPace(Number(v))}
                      parse={(v) => {
                        const p = parsePace(v);
                        return p !== null ? String(p) : null;
                      }}
                      onSave={(v) =>
                        updateStep(i, { target_pace_low: Number(v) })
                      }
                    />
                    -
                    <InlineEdit
                      value={String(step.target_pace_high)}
                      editable={editable}
                      format={(v) => formatPace(Number(v))}
                      parse={(v) => {
                        const p = parsePace(v);
                        return p !== null ? String(p) : null;
                      }}
                      onSave={(v) =>
                        updateStep(i, { target_pace_high: Number(v) })
                      }
                    />
                  </>
                ) : (
                  <InlineEdit
                    value={String(step.target_pace)}
                    editable={editable}
                    format={(v) => formatPace(Number(v))}
                    parse={(v) => {
                      const p = parsePace(v);
                      return p !== null ? String(p) : null;
                    }}
                    onSave={(v) =>
                      updateStep(i, { target_pace: Number(v) })
                    }
                  />
                )}
                /km
              </span>
            )}

            {/* HR zone */}
            {step.target_hr_low && step.target_hr_high && (
              <span className="font-mono text-red-400/60">
                <InlineEdit
                  value={String(step.target_hr_low)}
                  editable={editable}
                  onSave={(v) =>
                    updateStep(i, { target_hr_low: Number(v) })
                  }
                />
                -
                <InlineEdit
                  value={String(step.target_hr_high)}
                  editable={editable}
                  onSave={(v) =>
                    updateStep(i, { target_hr_high: Number(v) })
                  }
                />{" "}
                bpm
              </span>
            )}

            {/* Distance */}
            {step.distance_meters && (
              <InlineEdit
                value={String(step.distance_meters)}
                editable={editable}
                format={(v) => `${(Number(v) / 1000).toFixed(1)}km`}
                parse={(v) => {
                  const n = parseFloat(v);
                  return isNaN(n) ? null : String(Math.round(n * 1000));
                }}
                onSave={(v) =>
                  updateStep(i, { distance_meters: Number(v) })
                }
              />
            )}

            {/* Duration */}
            {step.duration_minutes && (
              <InlineEdit
                value={String(step.duration_minutes)}
                editable={editable}
                format={(v) => `${v}min`}
                parse={(v) => {
                  const n = parseFloat(v);
                  return isNaN(n) ? null : String(n);
                }}
                onSave={(v) =>
                  updateStep(i, { duration_minutes: Number(v) })
                }
              />
            )}

            {/* Repeats */}
            {step.repeats && step.repeats > 1 && (
              <span>&times;{step.repeats}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
