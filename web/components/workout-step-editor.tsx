"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { NormalizedStep } from "@/lib/normalize-steps";

// Re-export NormalizedStep as WorkoutStep for backward compat
type WorkoutStep = NormalizedStep;

interface WorkoutStepEditorProps {
  steps: WorkoutStep[];
  editable?: boolean;
  onStepsChange?: (steps: WorkoutStep[]) => void;
  isDelta?: boolean;
}

// ── Step type colors ─────────────────────────────────────────
// Background fills (for block bodies)
const stepBgColors: Record<string, string> = {
  warmup: "bg-blue-500/15",
  warm_up: "bg-blue-500/15",
  work: "bg-red-500/15",
  interval: "bg-red-500/15",
  recovery: "bg-emerald-500/15",
  rest: "bg-emerald-500/15",
  cooldown: "bg-cyan-500/15",
  cool_down: "bg-cyan-500/15",
  tempo: "bg-orange-500/15",
  threshold: "bg-orange-500/15",
  easy: "bg-green-500/15",
  aerobic: "bg-blue-500/15",
  vo2max: "bg-purple-500/15",
  strides: "bg-amber-500/15",
};

// Left accent bar colors
const stepAccentColors: Record<string, string> = {
  warmup: "bg-blue-400",
  warm_up: "bg-blue-400",
  work: "bg-red-400",
  interval: "bg-red-400",
  recovery: "bg-emerald-400",
  rest: "bg-emerald-400",
  cooldown: "bg-cyan-400",
  cool_down: "bg-cyan-400",
  tempo: "bg-orange-400",
  threshold: "bg-orange-400",
  easy: "bg-green-400",
  aerobic: "bg-blue-400",
  vo2max: "bg-purple-400",
  strides: "bg-amber-400",
};

// Text accent colors for type labels
const stepTextColors: Record<string, string> = {
  warmup: "text-blue-400",
  warm_up: "text-blue-400",
  work: "text-red-400",
  interval: "text-red-400",
  recovery: "text-emerald-400",
  rest: "text-emerald-400",
  cooldown: "text-cyan-400",
  cool_down: "text-cyan-400",
  tempo: "text-orange-400",
  threshold: "text-orange-400",
  easy: "text-green-400",
  aerobic: "text-blue-400",
  vo2max: "text-purple-400",
  strides: "text-amber-400",
};

// ── Formatters ───────────────────────────────────────────────

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

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${meters}m`;
}

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${Math.round(minutes)}min`;
}

// ── Repeat Group Detection ───────────────────────────────────

interface RepeatGroupItem {
  kind: "repeat";
  repeats: number;
  steps: WorkoutStep[];
}

interface SingleStepItem {
  kind: "single";
  step: WorkoutStep;
}

type StepItem = SingleStepItem | RepeatGroupItem;

/**
 * Detect repeated patterns in a flat step list.
 * Looks for alternating patterns like [interval, recovery, interval, recovery]
 * and groups them into repeat blocks.
 */
function detectRepeatGroups(steps: WorkoutStep[]): StepItem[] {
  if (!steps || steps.length === 0) return [];

  const result: StepItem[] = [];
  let i = 0;

  while (i < steps.length) {
    // Try pattern lengths from 2 down to 1 (but only group patterns of 2+)
    let matched = false;

    for (let patLen = 2; patLen <= 4; patLen++) {
      // Need at least 2 repetitions to form a group
      if (i + patLen * 2 > steps.length) continue;

      const pattern = steps.slice(i, i + patLen);

      // Count how many times this pattern repeats
      let reps = 1;
      let j = i + patLen;
      while (j + patLen <= steps.length) {
        const candidate = steps.slice(j, j + patLen);
        if (patternsMatch(pattern, candidate)) {
          reps++;
          j += patLen;
        } else {
          break;
        }
      }

      if (reps >= 2) {
        result.push({
          kind: "repeat",
          repeats: reps,
          steps: pattern,
        });
        i = j; // skip past all repetitions
        matched = true;
        break;
      }
    }

    if (!matched) {
      result.push({ kind: "single", step: steps[i] });
      i++;
    }
  }

  return result;
}

/** Check if two step sequences have matching types and distances (fuzzy match). */
function patternsMatch(a: WorkoutStep[], b: WorkoutStep[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (normalizeType(a[k].type) !== normalizeType(b[k].type)) return false;
    // Also match on distance/duration if present
    if (a[k].distance_meters !== b[k].distance_meters) return false;
    if (a[k].duration_minutes !== b[k].duration_minutes) return false;
  }
  return true;
}

function normalizeType(t: string): string {
  const lower = t.toLowerCase();
  if (lower === "warm_up") return "warmup";
  if (lower === "cool_down") return "cooldown";
  if (lower === "work") return "interval";
  if (lower === "rest") return "recovery";
  return lower;
}

// ── Inline Edit Component ────────────────────────────────────

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

// ── Step Block Renderer ──────────────────────────────────────

function StepBlock({
  step,
  editable,
  onUpdate,
}: {
  step: WorkoutStep;
  editable: boolean;
  onUpdate?: (patch: Partial<WorkoutStep>) => void;
}) {
  const type = step.type?.toLowerCase() || "work";
  const bgColor = stepBgColors[type] || "bg-muted/30";
  const accentColor = stepAccentColors[type] || "bg-muted-foreground/40";
  const textColor = stepTextColors[type] || "text-muted-foreground";

  const hasPace = !!(step.target_pace_low || step.target_pace_high);
  const hasHr = !!(step.target_hr_low && step.target_hr_high);
  const hasDistance = !!step.distance_meters;
  const hasDuration = !!step.duration_minutes;

  // Compute a proportional min-height based on distance or duration
  // Base: 28px, scaled up for longer steps
  let blockHeight = 28;
  if (step.distance_meters) {
    blockHeight = Math.max(28, Math.min(56, 28 + (step.distance_meters / 1000) * 12));
  } else if (step.duration_minutes) {
    blockHeight = Math.max(28, Math.min(56, 28 + step.duration_minutes * 1.5));
  }

  return (
    <div
      className={cn("flex items-center rounded-md overflow-hidden", bgColor)}
      style={{ minHeight: `${blockHeight}px` }}
    >
      {/* Colored accent bar */}
      <div className={cn("w-1 self-stretch shrink-0 rounded-l-md", accentColor)} />

      {/* Content */}
      <div className="flex items-center gap-2 px-2 py-1 flex-1 min-w-0">
        {/* Type label */}
        <span className={cn("text-[11px] font-semibold capitalize shrink-0 min-w-[52px]", textColor)}>
          {step.name && step.name !== step.type ? step.name : type.replace("_", " ")}
        </span>

        {/* Targets container */}
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          {/* Pace */}
          {hasPace && (
            <span className="text-[10px] font-mono text-muted-foreground/80 whitespace-nowrap">
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
                    onSave={(v) => onUpdate?.({ target_pace_low: Number(v) })}
                  />
                  {"-"}
                  <InlineEdit
                    value={String(step.target_pace_high)}
                    editable={editable}
                    format={(v) => formatPace(Number(v))}
                    parse={(v) => {
                      const p = parsePace(v);
                      return p !== null ? String(p) : null;
                    }}
                    onSave={(v) => onUpdate?.({ target_pace_high: Number(v) })}
                  />
                  <span className="text-muted-foreground/50">/km</span>
                </>
              ) : (
                // Single target_pace field (legacy)
                <>
                  <InlineEdit
                    value={String(step.target_pace_low || step.target_pace_high)}
                    editable={editable}
                    format={(v) => formatPace(Number(v))}
                    parse={(v) => {
                      const p = parsePace(v);
                      return p !== null ? String(p) : null;
                    }}
                    onSave={(v) => onUpdate?.({ target_pace_low: Number(v), target_pace_high: Number(v) })}
                  />
                  <span className="text-muted-foreground/50">/km</span>
                </>
              )}
            </span>
          )}

          {/* HR zone */}
          {hasHr && (
            <span className="text-[10px] font-mono text-red-400/60 whitespace-nowrap">
              <InlineEdit
                value={String(step.target_hr_low)}
                editable={editable}
                onSave={(v) => onUpdate?.({ target_hr_low: Number(v) })}
              />
              {"-"}
              <InlineEdit
                value={String(step.target_hr_high)}
                editable={editable}
                onSave={(v) => onUpdate?.({ target_hr_high: Number(v) })}
              />
              <span className="text-red-400/40"> bpm</span>
            </span>
          )}
        </div>

        {/* Distance / Duration (right-aligned) */}
        <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground/70">
          {hasDistance && (
            <InlineEdit
              value={String(step.distance_meters)}
              editable={editable}
              format={(v) => formatDistance(Number(v))}
              parse={(v) => {
                const n = parseFloat(v);
                return isNaN(n) ? null : String(Math.round(n * 1000));
              }}
              className="font-mono"
              onSave={(v) => onUpdate?.({ distance_meters: Number(v) })}
            />
          )}
          {hasDuration && (
            <InlineEdit
              value={String(step.duration_minutes)}
              editable={editable}
              format={(v) => formatDuration(Number(v))}
              parse={(v) => {
                const n = parseFloat(v);
                return isNaN(n) ? null : String(n);
              }}
              className="font-mono"
              onSave={(v) => onUpdate?.({ duration_minutes: Number(v) })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────

export function WorkoutStepEditor({
  steps,
  editable = false,
  onStepsChange,
  isDelta = false,
}: WorkoutStepEditorProps) {
  if (!steps || steps.length === 0) return null;

  // Flatten step index mapping for updates through repeat groups
  // We need to map visual items back to the flat step array indices
  const items = detectRepeatGroups(steps);

  // Build a mapping from items back to flat indices
  function buildFlatIndices(): number[][] {
    const indices: number[][] = [];
    let flatIdx = 0;
    for (const item of items) {
      if (item.kind === "single") {
        indices.push([flatIdx]);
        flatIdx++;
      } else {
        // repeat group: repeats * patternLen steps
        const groupIndices: number[] = [];
        for (let r = 0; r < item.repeats; r++) {
          for (let s = 0; s < item.steps.length; s++) {
            groupIndices.push(flatIdx);
            flatIdx++;
          }
        }
        indices.push(groupIndices);
      }
    }
    return indices;
  }

  const flatIndices = buildFlatIndices();

  function updateStep(index: number, patch: Partial<WorkoutStep>) {
    if (!onStepsChange) return;
    const updated = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onStepsChange(updated);
  }

  function updateRepeatStep(
    groupFlatIndices: number[],
    templateIdx: number,
    patternLen: number,
    repeats: number,
    patch: Partial<WorkoutStep>,
  ) {
    if (!onStepsChange) return;
    // Update all instances of this template step across all repetitions
    const updated = [...steps];
    for (let r = 0; r < repeats; r++) {
      const flatIdx = groupFlatIndices[r * patternLen + templateIdx];
      if (flatIdx != null) {
        updated[flatIdx] = { ...updated[flatIdx], ...patch };
      }
    }
    onStepsChange(updated);
  }

  return (
    <div
      className={cn(
        "mt-1.5 space-y-0.5 rounded-md",
        isDelta && "bg-yellow-500/10 ring-1 ring-yellow-500/20 p-1.5",
      )}
    >
      {items.map((item, itemIdx) => {
        if (item.kind === "single") {
          const flatIdx = flatIndices[itemIdx][0];
          return (
            <StepBlock
              key={`step-${itemIdx}`}
              step={item.step}
              editable={editable}
              onUpdate={(patch) => updateStep(flatIdx, patch)}
            />
          );
        }

        // Repeat group
        const groupIndices = flatIndices[itemIdx];
        return (
          <div
            key={`repeat-${itemIdx}`}
            className="rounded-md border border-dashed border-muted-foreground/25 bg-muted/10 overflow-hidden"
          >
            {/* Repeat header */}
            <div className="flex items-center gap-1 px-2 py-0.5">
              <span className="text-[10px] font-bold text-muted-foreground/90">
                {item.repeats}&times;
              </span>
              <span className="text-[10px] text-muted-foreground/50">repeat</span>
            </div>

            {/* Template steps */}
            <div className="px-1 pb-1 space-y-0.5">
              {item.steps.map((step, templateIdx) => (
                <StepBlock
                  key={`repeat-${itemIdx}-step-${templateIdx}`}
                  step={step}
                  editable={editable}
                  onUpdate={(patch) =>
                    updateRepeatStep(
                      groupIndices,
                      templateIdx,
                      item.steps.length,
                      item.repeats,
                      patch,
                    )
                  }
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
