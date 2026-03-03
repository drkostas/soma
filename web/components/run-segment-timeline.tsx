// web/components/run-segment-timeline.tsx
"use client";
import { motion, AnimatePresence, Reorder } from "motion/react";
import { Plus, GripVertical, Trash2, Zap, BookmarkPlus, Check, Repeat2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import SegmentEditor, { Segment, RepeatGroup, SegmentItem, BPM_DEFAULTS, TYPE_COLORS } from "./segment-editor";
import { nanoid } from "nanoid";
import { useState, useMemo } from "react";

function newSegment(type: Segment["type"] = "easy", duration_s = 600): Segment {
  const bpm = BPM_DEFAULTS[type] ?? { min: 125, max: 145, valence_min: 0.3, valence_max: 0.7 };
  return { id: nanoid(), type, duration_s, bpm_min: bpm.min, bpm_max: bpm.max, bpm_tolerance: 8, sync_mode: "auto", valence_min: bpm.valence_min, valence_max: bpm.valence_max };
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function flatItems(items: SegmentItem[]): Segment[] {
  return items.flatMap(item => item.type === "repeat" ? item.children : [item as Segment]);
}

interface Props {
  items: SegmentItem[];
  onChange: (items: SegmentItem[]) => void;
  focusedIdx: number;
  onFocus: (idx: number) => void;
  onPumpUp: (idx: number) => void;
  onSavePlan?: (name: string) => Promise<void>;
}

export default function RunSegmentTimeline({ items, onChange, focusedIdx, onFocus, onPumpUp, onSavePlan }: Props) {
  const [savingPlan, setSavingPlan] = useState(false);
  const [planNameInput, setPlanNameInput] = useState(false);
  const [planName, setPlanName] = useState("");
  const [saved, setSaved] = useState(false);
  const [savePlanError, setSavePlanError] = useState(false);

  async function handleSavePlan() {
    const name = planName.trim();
    if (!name || !onSavePlan) return;
    setSavingPlan(true);
    setSavePlanError(false);
    try {
      await onSavePlan(name);
      setSavingPlan(false);
      setPlanNameInput(false);
      setPlanName("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSavingPlan(false);
      setSavePlanError(true);
      toast.error("Failed to save plan — try again");
      setTimeout(() => setSavePlanError(false), 3000);
    }
  }

  // Flat start index for each top-level item
  const flatStarts = useMemo(() => {
    const starts: number[] = [];
    let idx = 0;
    for (const item of items) {
      starts.push(idx);
      idx += item.type === "repeat" ? item.children.length : 1;
    }
    return starts;
  }, [items]);

  function updateSegment(itemIdx: number, newSeg: Segment) {
    const next = [...items];
    next[itemIdx] = newSeg;
    onChange(next);
  }

  function updateGroupChild(itemIdx: number, templateIdx: number, newSeg: Segment) {
    const group = items[itemIdx] as RepeatGroup;
    const newChildren = group.children.map((child, ci) =>
      ci % group.template_size === templateIdx ? { ...newSeg, id: child.id } : child
    );
    const next = [...items];
    next[itemIdx] = { ...group, children: newChildren };
    onChange(next);
  }

  function removeItem(itemIdx: number) {
    const flatIdx = flatStarts[itemIdx];
    onChange(items.filter((_, i) => i !== itemIdx));
    if (focusedIdx >= flatIdx) onFocus(-1);
  }

  function addSegment() {
    onChange([...items, newSegment()]);
  }

  const totalMin = Math.round(flatItems(items).reduce((s, seg) => s + seg.duration_s, 0) / 60);

  return (
    <div className="flex flex-col h-full">
      <Reorder.Group axis="y" values={items} onReorder={onChange} className="flex-1 overflow-y-auto p-3 space-y-1.5">
        <AnimatePresence>
          {items.map((item, itemIdx) => {
            const flatStart = flatStarts[itemIdx];

            if (item.type === "repeat") {
              const group = item as RepeatGroup;
              const template = group.children.slice(0, group.template_size);
              const totalGroupTime = group.children.reduce((s, c) => s + c.duration_s, 0);

              return (
                <Reorder.Item key={group.id} value={group} as="div">
                  <motion.div layout className="rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center gap-1.5 px-2 py-1.5 select-none cursor-grab active:cursor-grabbing">
                      <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />
                      <Repeat2 className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-xs font-bold text-foreground">{group.repeat_count}×</span>
                      <span className="text-xs text-muted-foreground">repeat</span>
                      <span className="text-xs text-muted-foreground ml-auto">{fmt(totalGroupTime)} total</span>
                      <button
                        type="button"
                        onClick={() => removeItem(itemIdx)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-0.5 ml-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Template steps */}
                    <div className="px-2 pb-2 space-y-1">
                      {template.map((seg, templateIdx) => {
                        const segFlatIdx = flatStart + templateIdx;
                        const isFocused = focusedIdx === segFlatIdx;
                        return (
                          <motion.div
                            key={seg.id}
                            layout
                            animate={{ minHeight: isFocused ? 120 : 36 }}
                            className="rounded-md border bg-card overflow-hidden"
                          >
                            <div
                              className="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none"
                              onClick={() => onFocus(isFocused ? -1 : segFlatIdx)}
                            >
                              <div className={`w-1 h-5 rounded-full shrink-0 ${TYPE_COLORS[seg.type] ?? "bg-muted"}`} />
                              <span className="text-xs font-medium capitalize flex-1">{seg.type}</span>
                              <span className="text-xs text-muted-foreground">{fmt(seg.duration_s * group.repeat_count)}</span>
                              <span className="text-xs text-muted-foreground">{seg.bpm_min}–{seg.bpm_max}</span>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); onPumpUp(segFlatIdx); }}
                                className="text-muted-foreground hover:text-amber-400 transition-colors p-0.5"
                              >
                                <Zap className="w-3 h-3" />
                              </button>
                            </div>
                            <AnimatePresence>
                              {isFocused && (
                                <SegmentEditor
                                  key={seg.id}
                                  segment={seg}
                                  onChange={s => updateGroupChild(itemIdx, templateIdx, s)}
                                />
                              )}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                </Reorder.Item>
              );
            }

            // Regular segment
            const seg = item as Segment;
            const isFocused = focusedIdx === flatStart;
            return (
              <Reorder.Item key={seg.id} value={seg} as="div">
                <motion.div
                  layout
                  animate={{ minHeight: isFocused ? 120 : 48 }}
                  className="rounded-lg border bg-card overflow-hidden"
                >
                  <div
                    className="flex items-center gap-2 p-2 cursor-pointer select-none"
                    onClick={() => onFocus(isFocused ? -1 : flatStart)}
                  >
                    <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                      <GripVertical className="w-3 h-3" />
                    </div>
                    <div className={`w-1.5 h-8 rounded-full shrink-0 ${TYPE_COLORS[seg.type] ?? "bg-muted"}`} />
                    <span className="text-xs font-medium capitalize flex-1">{seg.type}</span>
                    <span className="text-xs text-muted-foreground">{fmt(seg.duration_s)}</span>
                    <span className="text-xs text-muted-foreground">{seg.bpm_min}–{seg.bpm_max} BPM</span>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onPumpUp(flatStart); }}
                      className="text-muted-foreground hover:text-amber-400 transition-colors p-0.5"
                    >
                      <Zap className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); removeItem(itemIdx); }}
                      className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <AnimatePresence>
                    {isFocused && (
                      <SegmentEditor key={seg.id} segment={seg} onChange={s => updateSegment(itemIdx, s)} />
                    )}
                  </AnimatePresence>
                </motion.div>
              </Reorder.Item>
            );
          })}
        </AnimatePresence>
      </Reorder.Group>

      <div className="p-3 border-t space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={addSegment} className="text-xs h-7">
            <Plus className="w-3 h-3 mr-1" /> Add Segment
          </Button>
          {onSavePlan && !planNameInput && (
            <Button variant="outline" size="sm" onClick={() => setPlanNameInput(true)} className="text-xs h-7 gap-1">
              {saved ? <><Check className="w-3 h-3 text-green-500" /> Saved!</>
                : savePlanError ? <><AlertCircle className="w-3 h-3 text-destructive" /> Failed</>
                : <><BookmarkPlus className="w-3 h-3" /> Save Plan</>}
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">Total: {totalMin} min</span>
        </div>
        {planNameInput && (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={planName}
              onChange={e => setPlanName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSavePlan(); if (e.key === "Escape") { setPlanNameInput(false); setPlanName(""); } }}
              placeholder="Plan name…"
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" className="h-7 text-xs" disabled={!planName.trim() || savingPlan} onClick={handleSavePlan}>
              {savingPlan ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setPlanNameInput(false); setPlanName(""); }}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
