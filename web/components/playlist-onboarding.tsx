"use client";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface Props {
  spotifyConnected: boolean;
  libraryAnalysed: boolean;
  onLibraryAnalysed: () => void;
  onRunSelected: () => void;
}

export default function PlaylistOnboarding({
  spotifyConnected,
  libraryAnalysed,
  onLibraryAnalysed,
  onRunSelected,
}: Props) {
  const [analysing, setAnalysing] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; pct: number } | null>(null);

  async function handleAnalyse() {
    setAnalysing(true);
    setProgress({ stage: "Starting…", pct: 0 });
    try {
      const res = await fetch("/api/playlist/spotify/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_ids: ["liked"] }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.trim().split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));
          if (event === "progress") {
            setProgress({ stage: data.stage, pct: data.pct });
          } else if (event === "done") {
            setProgress({ stage: `Done — ${data.new} tracks analysed, ${data.cached} cached`, pct: 100 });
            onLibraryAnalysed();
          } else if (event === "error") {
            setProgress({ stage: `Error: ${data.message}`, pct: 0 });
          }
        }
      }
    } catch (err) {
      setProgress({ stage: `Error: ${String(err)}`, pct: 0 });
    } finally {
      setAnalysing(false);
    }
  }

  const steps = [
    {
      n: 1,
      label: "Connect Spotify",
      done: spotifyConnected,
      locked: false,
      action: (
        <Button asChild size="sm">
          <a href="/api/playlist/spotify/auth?return_to=/playlist">Connect →</a>
        </Button>
      ),
    },
    {
      n: 2,
      label: "Analyse your library",
      done: libraryAnalysed,
      locked: !spotifyConnected,
      action: (
        <Button size="sm" onClick={handleAnalyse} disabled={analysing}>
          {analysing ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Analysing…</> : "Analyse Library"}
        </Button>
      ),
    },
    {
      n: 3,
      label: "Pick a run",
      done: false,
      locked: !libraryAnalysed,
      action: (
        <Button size="sm" onClick={onRunSelected}>
          Pick Run →
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Playlist Builder</h1>
        <p className="text-muted-foreground text-sm">
          Build BPM-matched running playlists from your Spotify library
        </p>
      </div>
      <div className="w-full max-w-sm space-y-3">
        {steps.map((step) => (
          <motion.div
            key={step.n}
            layout
            animate={{ opacity: step.locked ? 0.4 : 1 }}
            className="flex items-center gap-4 p-4 rounded-lg border bg-card"
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                step.done
                  ? "bg-primary text-primary-foreground"
                  : "border-2 border-muted-foreground text-muted-foreground"
              }`}
            >
              {step.done ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                >
                  <Check className="w-4 h-4" />
                </motion.div>
              ) : (
                step.n
              )}
            </div>
            <span className="flex-1 text-sm font-medium">{step.label}</span>
            {!step.done && !step.locked && step.action}
          </motion.div>
        ))}

        {/* Progress panel — shown while analysing or after */}
        {progress && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border bg-card p-4 space-y-2"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate pr-2">{progress.stage}</span>
              <span className="shrink-0">{progress.pct}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                animate={{ width: `${progress.pct}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            {!analysing && progress.pct < 100 && (
              <p className="text-xs text-muted-foreground">
                You can navigate away — progress is saved. Come back and re-click to continue.
              </p>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
