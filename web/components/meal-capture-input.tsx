"use client";

/**
 * Say what you ate.
 *
 * The whole point of this box is that it lets go of you immediately. The sentence is posted, an
 * acknowledgement appears, and the meal fills itself in behind you. It never waits on the agent,
 * which takes 28 to 50 seconds on a described plate, because that wait is the friction this
 * feature exists to remove.
 */

import React, { useEffect, useState } from "react";
import { Camera, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CaptureMode = "log" | "calibrate";

/** What goes on the wire. Pure, so it can be tested without rendering anything. */
export function captureBody(text: string, image: string | null, mode: CaptureMode) {
  return { text: text.trim(), image, mode };
}

export function placeholderFor(slot: string): string {
  return `What did you eat for ${slot.replace(/_/g, " ")}?`;
}

/** The acknowledgement. It must not claim the meal is there yet, because it is not. */
export function ackFor(mode: CaptureMode): string {
  return mode === "log" ? "Got it, logging it now." : "Got it, I'll have it ready to check.";
}

interface Props {
  slot: string;
  defaultMode: CaptureMode;
  onCaptured?: (id: number) => void;
}

export function MealCaptureInput({ slot, defaultMode, onCaptured }: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptureMode>(defaultMode);
  const [sending, setSending] = useState(false);
  const [ack, setAck] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The remembered choice, fetched once. The prop is the fallback until it arrives, so the toggle
  // never sits in a state the owner did not pick.
  useEffect(() => {
    let alive = true;
    fetch("/api/nutrition/capture/mode")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { mode?: string } | null) => {
        if (alive && (d?.mode === "log" || d?.mode === "calibrate")) setMode(d.mode);
      })
      .catch(() => { /* the fallback stands */ });
    return () => { alive = false; };
  }, []);

  const attach = async (file: File) => {
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/nutrition/capture/upload", { method: "POST", body: form });
      if (res.ok) setImage(((await res.json()) as { path: string }).path);
      else setError("That photo would not upload.");
    } catch {
      setError("That photo would not upload.");
    }
  };

  /** The last choice becomes the default, so the toggle is set once and then forgotten. */
  const rememberMode = (next: CaptureMode) => {
    setMode(next);
    void fetch("/api/nutrition/capture/mode", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next }),
    }).catch(() => { /* remembering is a convenience, never a blocker */ });
  };

  const send = async () => {
    if (!text.trim() && !image) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/nutrition/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(captureBody(text, image, mode)),
      });
      if (!res.ok) { setError("That did not send. Your words are still here."); return; }
      const { id } = (await res.json()) as { id: number };
      setAck(ackFor(mode));
      setText("");
      setImage(null);
      onCaptured?.(id);
      setTimeout(() => setAck(null), 5000);
    } catch {
      setError("That did not send. Your words are still here.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3 flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
        placeholder={placeholderFor(slot)}
        rows={2}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />

      {image && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>photo attached</span>
          <button type="button" onClick={() => setImage(null)} aria-label="Remove photo">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="cursor-pointer text-muted-foreground hover:text-foreground" title="Attach a photo">
          <Camera className="h-4 w-4" />
          <input
            type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); }}
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox" checked={mode === "calibrate"}
            onChange={(e) => rememberMode(e.target.checked ? "calibrate" : "log")}
          />
          Let me check it first
        </label>

        <span className="flex-1" />

        {ack && <span className="text-xs text-muted-foreground">{ack}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}

        <Button size="sm" disabled={sending || (!text.trim() && !image)} onClick={() => void send()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
