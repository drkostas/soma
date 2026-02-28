// web/components/run-segment-timeline.tsx
"use client";
import { motion, AnimatePresence, Reorder } from "motion/react";
import { Plus, GripVertical, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import SegmentEditor, { Segment, SegmentType, TYPE_COLORS, SEGMENT_TYPES } from "./segment-editor";
import { nanoid } from "nanoid";


const BPM_DEFAULTS: Record<SegmentType, { min: number; max: number }> = {
  warmup: { min: 100, max: 140 }, easy: { min: 125, max: 145 }, aerobic: { min: 125, max: 145 },
  tempo: { min: 160, max: 180 }, interval: { min: 175, max: 195 }, vo2max: { min: 175, max: 195 },
  recovery: { min: 125, max: 145 }, rest: { min: 80, max: 110 }, strides: { min: 160, max: 180 }, cooldown: { min: 60, max: 90 },
};

function newSegment(type: Segment["type"] = "easy", duration_s = 600): Segment {
  const bpm = BPM_DEFAULTS[type] ?? { min: 125, max: 145 };
  return { id: nanoid(), type, duration_s, bpm_min: bpm.min, bpm_max: bpm.max, bpm_tolerance: 8, sync_mode: "auto", valence_min: 0.3, valence_max: 0.7 };
}

interface Props {
  segments: Segment[];
  onChange: (segs: Segment[]) => void;
  focusedIdx: number;
  onFocus: (idx: number) => void;
  onPumpUp: (idx: number) => void;
}

export default function RunSegmentTimeline({ segments, onChange, focusedIdx, onFocus, onPumpUp }: Props) {
  function updateSegment(idx: number, s: Segment) {
    const next = [...segments]; next[idx] = s; onChange(next);
  }
  function removeSegment(idx: number) {
    onChange(segments.filter((_, i) => i !== idx));
    if (focusedIdx === idx) onFocus(-1);
  }
  function addSegment() {
    onChange([...segments, newSegment()]);
  }

  const totalMin = Math.round(segments.reduce((s, seg) => s + seg.duration_s, 0) / 60);

  return (
    <div className="flex flex-col h-full">
      <Reorder.Group axis="y" values={segments} onReorder={onChange} className="flex-1 overflow-y-auto p-3 space-y-1">
        <AnimatePresence>
          {segments.map((seg, idx) => {
            const isFocused = focusedIdx === idx;
            return (
              <Reorder.Item key={seg.id} value={seg} as="div">
                <motion.div
                  layout
                  animate={{ minHeight: isFocused ? 120 : 48 }}
                  className="rounded-lg border bg-card overflow-hidden"
                >
                  {/* Segment header */}
                  <div
                    className="flex items-center gap-2 p-2 cursor-pointer select-none"
                    onClick={() => onFocus(isFocused ? -1 : idx)}
                  >
                    <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                      <GripVertical className="w-3 h-3" />
                    </div>
                    <div className={`w-1.5 h-8 rounded-full shrink-0 ${TYPE_COLORS[seg.type] ?? "bg-muted"}`} />
                    <span className="text-xs font-medium capitalize flex-1">{seg.type}</span>
                    <span className="text-xs text-muted-foreground">{Math.floor(seg.duration_s/60)}:{String(seg.duration_s%60).padStart(2,"0")}</span>
                    <span className="text-xs text-muted-foreground">{seg.bpm_min}–{seg.bpm_max} BPM</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); onPumpUp(idx); }} className="text-muted-foreground hover:text-amber-400 transition-colors p-0.5">
                      <Zap className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeSegment(idx); }} className="text-muted-foreground hover:text-destructive transition-colors p-0.5">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isFocused && (
                      <SegmentEditor key={seg.id} segment={seg} onChange={(s) => updateSegment(idx, s)} />
                    )}
                  </AnimatePresence>
                </motion.div>
              </Reorder.Item>
            );
          })}
        </AnimatePresence>
      </Reorder.Group>

      <div className="p-3 border-t flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addSegment} className="text-xs h-7">
          <Plus className="w-3 h-3 mr-1" /> Add Segment
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">Total: {totalMin} min</span>
      </div>
    </div>
  );
}
