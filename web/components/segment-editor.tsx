// web/components/segment-editor.tsx
"use client";
import { motion } from "motion/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const SEGMENT_TYPES = ["warmup","easy","aerobic","tempo","interval","vo2max","recovery","rest","strides","cooldown"] as const;
type SegmentType = typeof SEGMENT_TYPES[number];

export const TYPE_COLORS: Record<SegmentType, string> = {
  warmup: "bg-yellow-500", easy: "bg-green-500", aerobic: "bg-blue-500",
  tempo: "bg-orange-500", interval: "bg-red-500", vo2max: "bg-purple-500",
  recovery: "bg-sky-400", rest: "bg-slate-400", strides: "bg-amber-400", cooldown: "bg-slate-600",
};

export interface Segment {
  id: string; type: SegmentType; duration_s: number;
  bpm_min: number; bpm_max: number; bpm_tolerance: number;
  sync_mode: "sync" | "async" | "auto";
  valence_min: number; valence_max: number;
}

interface Props {
  segment: Segment;
  onChange: (s: Segment) => void;
}

export default function SegmentEditor({ segment, onChange }: Props) {
  const mins = Math.floor(segment.duration_s / 60);
  const secs = segment.duration_s % 60;

  function update(patch: Partial<Segment>) {
    onChange({ ...segment, ...patch });
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="overflow-hidden"
    >
      <div className="p-3 space-y-3 bg-muted/30 rounded-b-lg border-x border-b">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={segment.type} onValueChange={(v) => update({ type: v as SegmentType })}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEGMENT_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Duration</Label>
            <div className="flex gap-1 mt-1">
              <Input type="number" value={mins} min={0} className="h-8 text-xs w-16"
                onChange={e => update({ duration_s: parseInt(e.target.value || "0") * 60 + secs })} />
              <span className="text-xs self-center text-muted-foreground">min</span>
              <Input type="number" value={secs} min={0} max={59} className="h-8 text-xs w-16"
                onChange={e => update({ duration_s: mins * 60 + parseInt(e.target.value || "0") })} />
              <span className="text-xs self-center text-muted-foreground">sec</span>
            </div>
          </div>
        </div>

        <div>
          <Label className="text-xs">BPM Range</Label>
          <div className="flex gap-2 items-center mt-1">
            <Input type="number" value={segment.bpm_min} className="h-8 text-xs w-16" onChange={e => update({ bpm_min: parseInt(e.target.value) })} />
            <span className="text-xs text-muted-foreground">–</span>
            <Input type="number" value={segment.bpm_max} className="h-8 text-xs w-16" onChange={e => update({ bpm_max: parseInt(e.target.value) })} />
            <span className="text-xs text-muted-foreground">±</span>
            <Input type="number" value={segment.bpm_tolerance} className="h-8 text-xs w-14" onChange={e => update({ bpm_tolerance: parseInt(e.target.value) })} />
          </div>
        </div>

        <div>
          <div className="flex justify-between">
            <Label className="text-xs">Valence (mood)</Label>
            <span className="text-xs text-muted-foreground">{segment.valence_min.toFixed(1)} – {segment.valence_max.toFixed(1)}</span>
          </div>
          <Slider
            min={0} max={1} step={0.1}
            value={[segment.valence_min, segment.valence_max]}
            onValueChange={([min, max]) => update({ valence_min: min, valence_max: max })}
            className="mt-2"
          />
        </div>

        <div>
          <Label className="text-xs">Sync mode</Label>
          <div className="flex gap-2 mt-1">
            {(["auto","sync","async"] as const).map(m => (
              <button key={m} type="button" onClick={() => update({ sync_mode: m })}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${segment.sync_mode === m ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

