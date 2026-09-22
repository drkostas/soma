"use client";

/**
 * Say what you ate.
 *
 * The whole point of this box is that it lets go of you immediately. The sentence is posted, an
 * acknowledgement appears, and the meal fills itself in behind you. It never waits on the agent,
 * which takes 28 to 50 seconds on a described plate, because that wait is the friction this
 * feature exists to remove.
 */

import React, { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Mic, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canDictate, heardNext, heardStart, heardText, type Heard } from "@/lib/dictation";

/**
 * The browser's own speech recognition, which is the same on-device idea as the app's Speak
 * button. Only the fields this box reads are declared, because the DOM lib does not ship these
 * types and a full definition would be a lot of surface for three properties.
 */
interface WebSpeech {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type WebSpeechCtor = new () => WebSpeech;

/** Chrome and Safari expose it under the prefix; Firefox does not have it at all. */
function speechCtor(): WebSpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: WebSpeechCtor; webkitSpeechRecognition?: WebSpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type CaptureMode = "log" | "calibrate";

/**
 * The browser's own timezone, so the day and the slot are decided on the clock on this screen.
 *
 * The route used to decide both from ITS clock, which is Vercel's, so at half past nine here it was
 * half past six there: dinner rather than pre-sleep, and the wrong calendar day either side of
 * midnight. Empty when the browser will not say, and the server falls back.
 */
export function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** What goes on the wire. Pure, so it can be tested without rendering anything. */
export function captureBody(text: string, image: string | null, mode: CaptureMode, tz = deviceTz()) {
  return { text: text.trim(), image, mode, tz };
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
  const [recording, setRecording] = useState(false);
  // Whether this browser has speech recognition at all. Resolved after mount, because the server
  // render has no window and a button that appears and then vanishes is worse than one that waits.
  const [speechReady, setSpeechReady] = useState(false);
  const recognition = useRef<WebSpeech | null>(null);
  // What was in the box when recording started. The transcript is rebuilt from this on every event
  // rather than appended to, because a result revises the utterance rather than continuing it.
  const dictationBase = useRef("");

  useEffect(() => { setSpeechReady(speechCtor() !== null); }, []);

  const dictate = () => {
    if (recording) { recognition.current?.stop(); return; }
    const Ctor = speechCtor();
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = "en-US";
    // ⛔ `continuous = false` ENDS THE SESSION AT THE FIRST PAUSE, which is the same ten-second cut
    // off the phone had. Describing a plate takes longer than one breath.
    r.continuous = true;
    // Interim results are what make it feel live: the words appear as they are said.
    r.interimResults = true;
    r.onresult = (e) => {
      // A continuous session keeps every result in the list, so the text is the settled ones joined
      // plus whichever guess is still in progress.
      let heard: Heard = heardStart(dictationBase.current);
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        heard = heardNext(heard, res?.[0]?.transcript ?? "", res?.isFinal === true);
      }
      setText(heardText(heard));
    };
    r.onend = () => setRecording(false);
    r.onerror = (e) => {
      setRecording(false);
      // Someone pressing it and saying nothing is not worth a message.
      if (e.error !== "no-speech" && e.error !== "aborted") setError("I could not hear that.");
    };
    recognition.current = r;
    dictationBase.current = text;
    setRecording(true);
    r.start();
  };

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
      const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      // The reason, not a shrug. A 413, a 415 and a dead network used to read identically.
      if (res.ok && body.path) setImage(body.path);
      else setError(body.error ?? `The upload failed (${res.status}).`);
    } catch (e) {
      setError(`soma could not reach the server (${(e as Error).message ?? "no connection"}).`);
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

      {/* ⛔ Messages go ABOVE the control row, never inside it. Anything in that row shares the
          width with Send, and on the phone both the error and then the acknowledgement pushed Send
          off the right edge. Moving only one of them is how it happened twice. */}
      {error && <div className="text-xs text-destructive">{error}</div>}
      {ack && !error && <div className="text-xs text-muted-foreground">{ack}</div>}

      <div className="flex items-center gap-3">
        {canDictate(speechReady, true) && (
          <button
            type="button"
            onClick={dictate}
            title={recording ? "Stop listening" : "Say what you ate"}
            aria-label={recording ? "Stop listening" : "Say what you ate"}
            className={recording ? "text-destructive" : "text-muted-foreground hover:text-foreground"}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}

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

        <Button size="sm" disabled={sending || (!text.trim() && !image)} onClick={() => void send()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
