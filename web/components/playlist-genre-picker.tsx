// web/components/playlist-genre-picker.tsx
"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Slider } from "@/components/ui/slider";

interface Props {
  selected: string[];
  onChange: (v: string[]) => void;
  threshold: number;
  onThresholdChange: (v: number) => void;
}

export default function PlaylistGenrePicker({ selected, onChange, threshold, onThresholdChange }: Props) {
  const [genres, setGenres] = useState<Array<{genre: string; count: string}>>([]);
  const [total, setTotal] = useState(1);

  useEffect(() => {
    fetch("/api/playlist/genres").then(r => r.json()).then(d => { setGenres(d.genres ?? []); setTotal(Number(d.total ?? 1)); }).catch(() => {});
  }, []);

  const visible = genres.filter(g => parseInt(g.count) / total >= threshold);

  function toggle(genre: string) {
    onChange(selected.includes(genre) ? selected.filter(g => g !== genre) : [...selected, genre]);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Min frequency</span><span>{(threshold * 100).toFixed(0)}%</span>
        </div>
        <Slider min={1} max={10} step={1} value={[threshold * 100]} onValueChange={([v]) => onThresholdChange(v / 100)} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence>
          {visible.map(g => (
            <motion.button
              key={g.genre}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => toggle(g.genre)}
              className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${selected.includes(g.genre) ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-muted-foreground/20 hover:border-primary"}`}
            >
              {g.genre} · {g.count}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
