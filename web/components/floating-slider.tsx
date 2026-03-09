"use client";

import { useCallback } from "react";

interface FloatingSliderProps {
  value: number;
  onChange: (value: number) => void;
  savedValue: number;
  onSave: () => void;
  onReset: () => void;
}

export function FloatingSlider({ value, onChange, savedValue, onSave, onReset }: FloatingSliderProps) {
  const isDirty = Math.abs(value - savedValue) > 0.001;
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  }, [onChange]);

  return (
    <div className="fixed bottom-4 left-16 z-50 w-[280px] bg-card border border-border rounded-lg shadow-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">Training Intensity</span>
        <span className="text-xs font-mono font-bold tabular-nums">
          {value.toFixed(2)}x
        </span>
      </div>
      <input
        type="range"
        min={0.5}
        max={1.5}
        step={0.01}
        value={value}
        onChange={handleChange}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, oklch(0.65 0.15 142), oklch(0.7 0.1 85) 50%, oklch(0.65 0.15 25))`,
        }}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">Easier</span>
        <span className="text-[10px] text-muted-foreground">Harder</span>
      </div>
      {isDirty && (
        <div className="flex gap-2 mt-2 pt-2 border-t border-border/30">
          <button
            onClick={onSave}
            className="flex-1 text-xs py-1 rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 transition-colors"
          >
            Save
          </button>
          <button
            onClick={onReset}
            className="text-xs py-1 px-3 rounded bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
