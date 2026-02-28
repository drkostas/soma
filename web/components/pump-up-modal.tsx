// web/components/pump-up-modal.tsx
"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Zap } from "lucide-react";

interface PumpUpSong {
  track_id: string;
  name: string;
  artist_name: string;
  tempo: number | null;
  energy: number | null;
  added_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  refreshKey?: number;
}

export default function PumpUpModal({ open, onClose, refreshKey }: Props) {
  const [songs, setSongs] = useState<PumpUpSong[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/playlist/pump-up")
      .then(r => r.json())
      .then((data: PumpUpSong[]) => setSongs(data))
      .catch(() => setSongs([]))
      .finally(() => setLoading(false));
  }, [open, refreshKey]);

  function handleRemove(trackId: string) {
    fetch(`/api/playlist/pump-up/${trackId}`, { method: "DELETE" })
      .then(() => setSongs(prev => prev.filter(s => s.track_id !== trackId)))
      .catch(() => {});
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Pump-up Bank
            <span className="text-sm font-normal text-muted-foreground ml-1">
              {songs.length}/10 songs
            </span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        ) : songs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Bank empty — add songs by clicking <Zap className="inline w-3.5 h-3.5 text-amber-400" /> on any song card
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {songs.map(song => {
              const energyPct = song.energy != null ? `${Math.round(song.energy * 100)}%` : "0%";
              return (
                <div key={song.track_id} className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{song.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{song.artist_name}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {song.tempo != null && (
                      <span className="text-xs text-muted-foreground">{song.tempo.toFixed(0)} BPM</span>
                    )}
                    <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden" title={`Energy: ${energyPct}`}>
                      <div className="h-full bg-amber-400/70 rounded-full" style={{ width: energyPct }} />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(song.track_id)}
                  >
                    <X className="w-3.5 h-3.5" />
                    <span className="sr-only">Remove</span>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
