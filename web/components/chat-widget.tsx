"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  text: string;
  // For assistant rows we show running tool indicators here.
  tools: string[];
  done: boolean;
  errored?: string;
}

const SOMA_CHAT_OPEN_KEY = "soma:chat:open";

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// Pull any text deltas out of a Claude Code stream-json event.
function extractTextFromEvent(evt: unknown): {
  textDelta?: string;
  toolName?: string;
} {
  if (!evt || typeof evt !== "object") return {};
  const e = evt as { type?: string; message?: unknown; delta?: unknown };

  // Partial streamed chunk: {type:"stream_event", event:{type:"content_block_delta", delta:{type:"text_delta", text:"..."}}}
  if (e.type === "stream_event") {
    const inner = (evt as { event?: { delta?: { type?: string; text?: string } } }).event;
    const d = inner?.delta;
    if (d?.type === "text_delta" && typeof d.text === "string") {
      return { textDelta: d.text };
    }
    return {};
  }

  // Full assistant message: {type:"assistant", message:{content:[{type:"text",text:"..."}]}}
  if (e.type === "assistant" && e.message && typeof e.message === "object") {
    const m = e.message as { content?: Array<{ type?: string; text?: string; name?: string }> };
    if (Array.isArray(m.content)) {
      const textPart = m.content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("");
      const toolUse = m.content.find((c) => c.type === "tool_use");
      return {
        textDelta: textPart || undefined,
        toolName: toolUse?.name,
      };
    }
  }

  return {};
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore open state across reloads (within a single tab).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SOMA_CHAT_OPEN_KEY);
      if (saved === "1") setOpen(true);
    } catch {
      // sessionStorage unavailable, ignore
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(SOMA_CHAT_OPEN_KEY, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [open]);

  // Fetch the current session id once when the widget mounts, so the user can see it.
  useEffect(() => {
    fetch("/api/chat/session")
      .then((r) => r.json())
      .then((d) => setSessionId(d.sessionId ?? null))
      .catch(() => setSessionId(null));
  }, []);

  // Autoscroll on new content.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");

    const userMsg: Message = {
      id: newId(),
      role: "user",
      text: message,
      tools: [],
      done: true,
    };
    const assistantId = newId();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      text: "",
      tools: [],
      done: false,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: ac.signal,
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => `${resp.status}`);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, done: true, errored: errText }
              : m
          )
        );
        return;
      }

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let blankIdx: number;
        while ((blankIdx = buf.indexOf("\n\n")) !== -1) {
          const rawEvent = buf.slice(0, blankIdx);
          buf = buf.slice(blankIdx + 2);
          let eventName = "message";
          let dataStr = "";
          for (const line of rawEvent.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice(7);
            else if (line.startsWith("data: ")) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (eventName === "fatal") {
            const f = parsed as { error?: string; stderr?: string };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      done: true,
                      errored: f.error || "claude subprocess failed",
                    }
                  : m
              )
            );
            continue;
          }
          if (eventName === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, done: true } : m
              )
            );
            continue;
          }
          if (eventName !== "event") continue;

          const { textDelta, toolName } = extractTextFromEvent(parsed);
          if (!textDelta && !toolName) continue;

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m;
              return {
                ...m,
                text: textDelta ? m.text + textDelta : m.text,
                tools: toolName ? [...m.tools, toolName] : m.tools,
              };
            })
          );
        }
      }
    } catch (err) {
      const aborted = (err as Error).name === "AbortError";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                done: true,
                errored: aborted ? "Cancelled" : String(err),
              }
            : m
        )
      );
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [input, busy]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close chat" : "Open chat"}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400"
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>

      <aside
        className={`fixed bottom-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-white/10 bg-zinc-950/95 backdrop-blur transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 3rem)" }}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-white">Claude</div>
            <div className="font-mono text-[10px] text-zinc-500" title={sessionId ?? ""}>
              {sessionId ? `session ${sessionId.slice(0, 8)}…` : "loading session…"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
            aria-label="Close panel"
          >
            <CloseIcon />
          </button>
        </header>

        <div
          ref={scrollerRef}
          className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        >
          {messages.length === 0 && (
            <div className="text-xs text-zinc-500">
              Resumes your local Claude Code session. Try: <em>“log my dinner: 200g chicken breast, 150g rice, 100g broccoli”</em>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </div>

        <form
          className="border-t border-white/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={busy ? "Claude is responding…" : "Message Claude…"}
              rows={2}
              disabled={busy}
              className="flex-1 resize-none rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
            />
            {busy ? (
              <button
                type="button"
                onClick={cancel}
                className="rounded-md bg-rose-500/20 px-3 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/30"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
          <div className="mt-1.5 text-[10px] text-zinc-500">
            Shift+Enter for newline. Each turn spawns a local <code className="text-zinc-400">claude -p</code> subprocess.
          </div>
        </form>
      </aside>
    </>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-500/20 px-3 py-2 text-sm text-white">
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-white/5 px-3 py-2 text-sm text-zinc-100">
        {msg.tools.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {msg.tools.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-[1px] text-[10px] text-amber-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {msg.text ? (
          <div className="prose prose-invert prose-sm max-w-none break-words [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-zinc-900 [&_pre]:p-2 [&_table]:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
          </div>
        ) : msg.done ? (
          <div className="text-xs italic text-zinc-500">(no text)</div>
        ) : (
          <div className="flex gap-1">
            <Dot />
            <Dot delay="120ms" />
            <Dot delay="240ms" />
          </div>
        )}
        {msg.errored && (
          <div className="mt-1 text-xs text-rose-400">⚠ {msg.errored}</div>
        )}
      </div>
    </div>
  );
}

function Dot({ delay = "0ms" }: { delay?: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500"
      style={{ animationDelay: delay }}
    />
  );
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12c0 4.97-4.03 9-9 9-1.5 0-2.91-.37-4.15-1.02L3 21l1.02-4.85A8.96 8.96 0 0 1 3 12c0-4.97 4.03-9 9-9s9 4.03 9 9z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
