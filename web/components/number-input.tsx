"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  label?: string;
  className?: string;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Round to the nearest step to avoid floating-point drift. */
function snapToStep(v: number, step: number, min: number) {
  const steps = Math.round((v - min) / step);
  return +(min + steps * step).toFixed(10);
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  label,
  className,
}: NumberInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      onChange(clamp(snapToStep(parsed, step, min), min, max));
    }
    setEditing(false);
  };

  const startEditing = () => {
    setDraft(String(value));
    setEditing(true);
    // select all after React renders the input
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    onChange(clamp(snapToStep(v, step, min), min, max));
  };

  const nudge = (dir: 1 | -1) => {
    onChange(clamp(snapToStep(value + dir * step, step, min), min, max));
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {/* Label */}
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}

      {/* Tappable number / inline edit */}
      <div className="flex items-center justify-center gap-1">
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            value={draft}
            min={min}
            max={max}
            step={step}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit(draft);
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            className="w-20 bg-background border border-border rounded px-2 py-0.5 text-sm text-center text-foreground outline-none focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={startEditing}
            className="text-sm font-medium tabular-nums text-foreground hover:text-primary transition-colors cursor-text"
          >
            {value}
          </button>
        )}
        {suffix && (
          <span className="text-xs text-muted-foreground">{suffix}</span>
        )}
      </div>

      {/* Slider row with +/- buttons */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => nudge(-1)}
          disabled={value <= min}
          className="text-xs leading-none text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed select-none px-0.5"
          aria-label="Decrease"
        >
          &minus;
        </button>

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSlider}
          className={cn(
            "flex-1 h-1.5 appearance-none rounded-full bg-muted cursor-pointer outline-none",
            // Webkit track
            "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted",
            // Webkit thumb
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:-mt-[3px]",
            // Firefox track
            "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted",
            // Firefox thumb
            "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-sm",
          )}
        />

        <button
          type="button"
          onClick={() => nudge(1)}
          disabled={value >= max}
          className="text-xs leading-none text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed select-none px-0.5"
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  );
}
