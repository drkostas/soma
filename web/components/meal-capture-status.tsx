"use client";

/**
 * What became of the sentences you sent today.
 *
 * The box lets go of you immediately, which is the point of it, and the cost of that was a screen
 * that looked identical whether a capture was in flight or had never been sent. This says where
 * each one is, in the same words the app uses.
 *
 * It polls only while something is still moving and stops by itself, so a settled day is free.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Camera, Send } from "lucide-react";
import { anyInFlight, captureDetail, captureHeadline, replyHint, shortAgo, stripCards, type CaptureCard } from "@/lib/capture-status";

/** How often to look while something is in flight. The agent takes tens of seconds, so this is
 *  frequent enough to feel live and far too slow to matter to anything. */
const POLL_MS = 4000;

/** A reply to one capture: text, a photo, or both. Sent to PATCH, which re-runs the thread. */
export async function sendReply(id: number, text: string, image: string | null): Promise<boolean> {
  const res = await fetch("/api/nutrition/capture", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, text: text.trim(), image }),
  });
  return res.ok;
}

interface Props {
  /** The day the screen is showing, so the strip follows the date navigation. */
  date?: string;
  /** Bumped by the input after a send, so a new capture appears without waiting for the poll. */
  version?: number;
}

function toneFor(c: CaptureCard): string {
  if (c.status === "failed") return "text-destructive";
  if (c.question) return "text-foreground";
  if (c.status === "logged") return "text-muted-foreground";
  return "text-foreground";
}

export function MealCaptureStatus({ date, version = 0 }: Props) {
  const [cards, setCards] = useState<CaptureCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Which capture has its reply box open, and what is in it. */
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [replyImage, setReplyImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [bump, setBump] = useState(0);

  const load = useCallback(async (): Promise<CaptureCard[]> => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    const res = await fetch(`/api/nutrition/capture/recent${qs}`);
    if (!res.ok) return [];
    return ((await res.json()) as { captures?: CaptureCard[] }).captures ?? [];
  }, [date]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const next = await load().catch(() => null);
      if (!alive) return;
      if (next) { setCards(next); setLoaded(true); }
      // Stop on our own once nothing is moving. A question counts as settled here: the machine
      // is finished with it and the owner is not, so it stays on screen without being polled.
      if (next && anyInFlight(next)) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [load, version, bump]);

  const attachToReply = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/nutrition/capture/upload", { method: "POST", body: form });
    if (res.ok) setReplyImage(((await res.json()) as { path: string }).path);
  };

  const submitReply = async (id: number) => {
    if (!reply.trim() && !replyImage) return;
    setSending(true);
    const ok = await sendReply(id, reply, replyImage).catch(() => false);
    setSending(false);
    if (!ok) return;
    setReplyTo(null);
    setReply("");
    setReplyImage(null);
    // The capture is back to `captured`, so restart the poll to follow it.
    setBump((b) => b + 1);
  };

  // Everything in flight plus the last couple of finished ones. The poll still watches the
  // whole day, so a capture that finishes off the bottom of the strip still stops the polling.
  const shown = stripCards(cards);
  if (!loaded || !shown.length) return null;

  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      {shown.map((c) => {
        const detail = captureDetail(c);
        return (
          <div key={c.id} className="rounded-md border bg-card/50 px-3 py-2 text-xs">
            <div className="flex items-baseline gap-2">
              <span className={`font-medium ${toneFor(c)}`}>{captureHeadline(c)}</span>
              {c.slot && <span className="text-muted-foreground">{c.slot.replace(/_/g, " ")}</span>}
              <span className="flex-1" />
              <span className="text-muted-foreground">{shortAgo(c.updatedAt)}</span>
            </div>
            {c.said && <div className="mt-0.5 text-muted-foreground italic truncate">{c.said}</div>}
            {detail && <div className="mt-0.5 text-muted-foreground">{detail}</div>}

            {replyTo === c.id ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  autoFocus
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitReply(c.id); if (e.key === "Escape") setReplyTo(null); }}
                  placeholder={c.question ? "Tell it what you ate" : "What should change?"}
                  className="flex-1 rounded border bg-background px-2 py-1 text-xs outline-none"
                />
                <label className="cursor-pointer text-muted-foreground hover:text-foreground" title="Attach a photo">
                  <Camera className="h-3.5 w-3.5" />
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachToReply(f); }} />
                </label>
                {replyImage && <span className="text-muted-foreground">photo attached</span>}
                <button type="button" disabled={sending || (!reply.trim() && !replyImage)}
                  onClick={() => void submitReply(c.id)} aria-label="Send reply"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => { setReplyTo(c.id); setReply(""); setReplyImage(null); }}
                className="mt-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">
                {replyHint(c)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
