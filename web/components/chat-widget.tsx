"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

type Step = TextStep | ThinkingStep | ToolStep;

interface TextStep {
  kind: "text";
  id: string;
  text: string;
}

interface ThinkingStep {
  kind: "thinking";
  id: string;
  text: string;
}

interface ToolStep {
  kind: "tool";
  id: string; // tool_use_id from claude
  name: string;
  inputJson: string; // accumulating partial JSON
  input: Record<string, unknown> | null; // parsed at content_block_stop
  output: string; // possibly truncated for inline render
  outputFull: string; // full string for "show full"
  outputTruncated: boolean;
  isError: boolean;
  status: "running" | "done";
}

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface Message {
  id: string;
  role: Role;
  // For user role: the original prompt text so we can retry.
  userPrompt?: string;
  steps: Step[];
  done: boolean;
  // Timestamp (ms) when the turn started, so we can show elapsed time.
  startedAt?: number;
  // Filled from result.usage on completion.
  usage?: Usage;
  durationMs?: number;
  errored?: string;
  erroredDetail?: string;
}

const SOMA_CHAT_OPEN_KEY = "soma:chat:open";
const SOMA_CHAT_HISTORY_KEY = "soma:chat:history";
// Don't grow localStorage forever — keep the last N messages.
const HISTORY_LIMIT = 50;

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// Summarize the relevant field of a tool's input as a one-liner.
function summarizeToolInput(
  name: string,
  input: Record<string, unknown> | null
): string {
  if (!input || typeof input !== "object") return "";
  const get = (k: string) => {
    const v = (input as Record<string, unknown>)[k];
    return typeof v === "string" ? v : undefined;
  };
  if (name === "Bash") return get("command") || "";
  if (name === "Read" || name === "Edit" || name === "Write") return get("file_path") || "";
  if (name === "Glob") return [get("pattern"), get("path")].filter(Boolean).join(" in ");
  if (name === "Grep") return [get("pattern"), get("path") || get("include")].filter(Boolean).join(" in ");
  if (name === "WebFetch") return get("url") || "";
  if (name === "TaskCreate") return get("subject") || "";
  if (name === "TaskUpdate") return get("taskId") || "";
  if (name === "ToolSearch") return get("query") || "";
  if (name.startsWith("mcp__tavily-")) {
    const q = get("query");
    if (q) return q;
    const urls = (input as { urls?: unknown }).urls;
    if (Array.isArray(urls) && urls.length > 0 && typeof urls[0] === "string") {
      return urls[0] as string;
    }
  }
  // Fallback: stringify a small object
  try {
    return JSON.stringify(input).slice(0, 100);
  } catch {
    return "";
  }
}

const TOOL_ICON: Record<string, string> = {
  Bash: "▶",
  Read: "📄",
  Edit: "✏️",
  Write: "📝",
  Glob: "🔎",
  Grep: "🔎",
  WebFetch: "🌐",
  ToolSearch: "🧰",
  Task: "🤖",
  TaskCreate: "✓",
  TaskUpdate: "✓",
};
function toolIcon(name: string): string {
  if (name in TOOL_ICON) return TOOL_ICON[name];
  if (name.startsWith("mcp__tavily")) return "🌐";
  if (name.startsWith("mcp__playwright")) return "🎭";
  if (name.startsWith("mcp__github")) return "🐙";
  if (name.startsWith("mcp__")) return "🔌";
  return "◆";
}

// Truncate long tool output for inline preview.
function truncateOutput(s: string, n = 800): { text: string; truncated: boolean } {
  if (s.length <= n) return { text: s, truncated: false };
  return { text: s.slice(0, n), truncated: true };
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SOMA_CHAT_OPEN_KEY) === "1") setOpen(true);
    } catch {
      // ignore
    }
    // Restore message history across refreshes.
    try {
      const raw = localStorage.getItem(SOMA_CHAT_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed)) {
          // Mark any half-done assistant message as cancelled so it doesn't
          // look like it's still streaming after a reload.
          setMessages(
            parsed.map((m) =>
              m.role === "assistant" && !m.done
                ? { ...m, done: true, errored: m.errored || "interrupted by reload" }
                : m
            )
          );
        }
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Persist messages to localStorage as they change (keep last N).
  useEffect(() => {
    try {
      const trimmed = messages.slice(-HISTORY_LIMIT);
      localStorage.setItem(SOMA_CHAT_HISTORY_KEY, JSON.stringify(trimmed));
    } catch {
      // localStorage may be full or unavailable
    }
  }, [messages]);
  useEffect(() => {
    try {
      sessionStorage.setItem(SOMA_CHAT_OPEN_KEY, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [open]);

  useEffect(() => {
    fetch("/api/chat/session")
      .then((r) => r.json())
      .then((d) => setSessionId(d.sessionId ?? null))
      .catch(() => setSessionId(null));
    // Best-effort hydrate from the on-disk JSONL — source of truth across
    // devices/browsers. Falls back to localStorage if the route fails or
    // returns no messages.
    fetch("/api/chat/history")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.messages) && d.messages.length > 0) {
          setMessages(d.messages as Message[]);
        }
      })
      .catch(() => {});
  }, []);

  const sendMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return;

    const userMsg: Message = {
      id: newId(),
      role: "user",
      userPrompt: message,
      steps: [{ kind: "text", id: newId(), text: message }],
      done: true,
    };
    const assistantId = newId();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      steps: [],
      done: false,
      startedAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setBusy(true);

    // Mutable scratchpad for the in-progress assistant message: maps the
    // streaming content_block_index to the step id we created for it, so
    // delta events know which step to append to.
    const blockIndexToStepId = new Map<number, string>();

    const ac = new AbortController();
    abortRef.current = ac;

    // Helpers that mutate the assistant message's steps array in React state.
    const mutateAssistant = (mutator: (m: Message) => Message) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? mutator(m) : m))
      );
    const upsertStep = (step: Step) => {
      mutateAssistant((m) => {
        const i = m.steps.findIndex((s) => s.id === step.id);
        const steps = i >= 0 ? m.steps.map((s) => (s.id === step.id ? step : s)) : [...m.steps, step];
        return { ...m, steps };
      });
    };
    const updateStep = (stepId: string, fn: (s: Step) => Step) => {
      mutateAssistant((m) => ({
        ...m,
        steps: m.steps.map((s) => (s.id === stepId ? fn(s) : s)),
      }));
    };

    const handleStreamEvent = (e: { event?: unknown }) => {
      const inner = e.event as
        | {
            type?: string;
            index?: number;
            content_block?: { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
            delta?: { type?: string; text?: string; partial_json?: string };
          }
        | undefined;
      if (!inner) return;
      const idx = typeof inner.index === "number" ? inner.index : -1;

      if (inner.type === "content_block_start" && inner.content_block && idx >= 0) {
        const cb = inner.content_block;
        if (cb.type === "text") {
          const step: TextStep = { kind: "text", id: newId(), text: "" };
          blockIndexToStepId.set(idx, step.id);
          upsertStep(step);
        } else if (cb.type === "thinking") {
          const step: ThinkingStep = { kind: "thinking", id: newId(), text: "" };
          blockIndexToStepId.set(idx, step.id);
          upsertStep(step);
        } else if (cb.type === "tool_use") {
          const step: ToolStep = {
            kind: "tool",
            id: cb.id || newId(),
            name: cb.name || "tool",
            inputJson: "",
            input: cb.input && Object.keys(cb.input).length > 0 ? cb.input : null,
            output: "",
            outputFull: "",
            outputTruncated: false,
            isError: false,
            status: "running",
          };
          blockIndexToStepId.set(idx, step.id);
          upsertStep(step);
        }
        return;
      }

      if (inner.type === "content_block_delta" && inner.delta && idx >= 0) {
        const stepId = blockIndexToStepId.get(idx);
        if (!stepId) return;
        const d = inner.delta as { type?: string; text?: string; thinking?: string; partial_json?: string };
        if (d.type === "text_delta" && typeof d.text === "string") {
          updateStep(stepId, (s) =>
            s.kind === "text" ? { ...s, text: s.text + d.text } : s
          );
        } else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
          updateStep(stepId, (s) =>
            s.kind === "thinking" ? { ...s, text: s.text + d.thinking! } : s
          );
        } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
          updateStep(stepId, (s) =>
            s.kind === "tool" ? { ...s, inputJson: s.inputJson + d.partial_json! } : s
          );
        }
        return;
      }

      if (inner.type === "content_block_stop" && idx >= 0) {
        const stepId = blockIndexToStepId.get(idx);
        if (!stepId) return;
        updateStep(stepId, (s) => {
          if (s.kind !== "tool") return s;
          if (s.input) return s;
          try {
            return { ...s, input: JSON.parse(s.inputJson) as Record<string, unknown> };
          } catch {
            return s;
          }
        });
        return;
      }
    };

    const handleAssistantEvent = (_evt: unknown) => {
      // Full assistant message fires after partials — partials already built
      // the steps, so we don't act on this event for state. (We could verify,
      // but it'd just double-render.)
    };

    const handleUserEvent = (evt: { message?: unknown }) => {
      // Tool results come back as user messages with content[*].type === 'tool_result'.
      const m = evt.message as { content?: Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> } | undefined;
      if (!m || !Array.isArray(m.content)) return;
      for (const item of m.content) {
        if (item.type !== "tool_result" || !item.tool_use_id) continue;
        const tuid = item.tool_use_id;
        let raw = "";
        if (typeof item.content === "string") raw = item.content;
        else if (Array.isArray(item.content)) {
          raw = (item.content as Array<{ type?: string; text?: string }>)
            .filter((c) => c.type === "text" && typeof c.text === "string")
            .map((c) => c.text as string)
            .join("\n");
        }
        const { text, truncated } = truncateOutput(raw);
        updateStep(tuid, (s) =>
          s.kind === "tool"
            ? {
                ...s,
                status: "done",
                isError: !!item.is_error,
                output: text,
                outputFull: raw,
                outputTruncated: truncated,
              }
            : s
        );
      }
    };

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => `${resp.status}`);
        mutateAssistant((m) => ({ ...m, done: true, errored: errText }));
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
            mutateAssistant((m) => ({
              ...m,
              done: true,
              errored: f.error || "claude subprocess failed",
              erroredDetail: f.stderr?.trim() || undefined,
            }));
            continue;
          }
          if (eventName === "done") {
            mutateAssistant((m) => ({ ...m, done: true }));
            fetch("/api/chat/session")
              .then((r) => r.json())
              .then((d) => setSessionId(d.sessionId ?? null))
              .catch(() => {});
            continue;
          }
          if (eventName !== "event") continue;

          const evt = parsed as { type?: string };
          if (evt.type === "stream_event") {
            handleStreamEvent(evt as { event?: unknown });
            continue;
          }
          if (evt.type === "assistant") {
            handleAssistantEvent(evt);
            continue;
          }
          if (evt.type === "user") {
            handleUserEvent(evt as { message?: unknown });
            continue;
          }
          if (evt.type === "result") {
            const r = evt as {
              session_id?: string;
              result?: string;
              duration_ms?: number;
              usage?: Usage;
            };
            if (typeof r.session_id === "string" && r.session_id.length > 0) {
              setSessionId(r.session_id);
            }
            // Capture usage + duration for the footer.
            mutateAssistant((m) => ({
              ...m,
              usage: r.usage || m.usage,
              durationMs:
                typeof r.duration_ms === "number" ? r.duration_ms : m.durationMs,
            }));
            // Fallback only if no text streamed (no partial deltas fired):
            // surface the result string as a single text step.
            if (typeof r.result === "string" && r.result.length > 0) {
              mutateAssistant((m) => {
                if (m.steps.some((s) => s.kind === "text" && s.text.length > 0)) {
                  return m;
                }
                return {
                  ...m,
                  steps: [...m.steps, { kind: "text", id: newId(), text: r.result as string }],
                };
              });
            }
            continue;
          }
        }
      }
    } catch (err) {
      const aborted = (err as Error).name === "AbortError";
      mutateAssistant((m) => ({
        ...m,
        done: true,
        errored: aborted ? "Cancelled" : String(err),
      }));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, []);

  const send = useCallback(() => {
    if (busy) return;
    const message = input.trim();
    if (!message) return;
    setInput("");
    void sendMessage(message);
  }, [input, busy, sendMessage]);

  // Re-send the previous user message (or specific message's userPrompt).
  const retry = useCallback(
    (prompt?: string) => {
      if (busy) return;
      const target =
        prompt ??
        (() => {
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role === "user" && m.userPrompt) return m.userPrompt;
          }
          return "";
        })();
      if (!target) return;
      void sendMessage(target);
    },
    [busy, messages, sendMessage]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Auto-scroll lock: only autoscroll if user is near the bottom.
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
      setAtBottom(dist < 40);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);
  useEffect(() => {
    if (!atBottom) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, atBottom]);

  // Keyboard shortcuts: Cmd/Ctrl+K toggles + focuses, Esc closes.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => textareaRef.current?.focus(), 0);
        return;
      }
      if (e.key === "Escape" && open) {
        // Don't steal Escape from other modal-like things; only act on it
        // when our textarea is focused, or no input is focused at all.
        const ae = document.activeElement;
        const ours =
          ae === textareaRef.current ||
          (ae && (ae.tagName !== "INPUT" && ae.tagName !== "TEXTAREA"));
        if (ours) {
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label="Open chat"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400"
        >
          <ChatIcon />
        </button>
      )}

      <aside
        className={`fixed bottom-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-white/10 bg-zinc-950/95 backdrop-blur transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{
          // Below the soma top bar on desktop; full-height on mobile.
          top: "calc(env(safe-area-inset-top, 0px) + 3rem)",
          // Use dvh so iOS Safari's URL bar / on-screen keyboard don't crop
          // the panel. paddingBottom honours the home-bar safe area.
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-white">Claude</div>
            <div className="font-mono text-[10px] text-zinc-500" title={sessionId ?? ""}>
              {sessionId === null
                ? "loading session…"
                : sessionId === ""
                  ? "new session (will be created on first message)"
                  : `session ${sessionId.slice(0, 8)}…`}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={async () => {
                if (busy) return;
                if (!confirm("Start a new conversation? This clears the chat history and resets the soma session.")) return;
                setMessages([]);
                try {
                  localStorage.removeItem(SOMA_CHAT_HISTORY_KEY);
                } catch {
                  // ignore
                }
                await fetch("/api/chat/session", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sessionId: "" }),
                }).catch(() => {});
                setSessionId("");
              }}
              disabled={busy}
              title="New conversation"
              aria-label="New conversation"
              className="rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              <NewIcon />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
              aria-label="Close panel"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="text-xs text-zinc-500">
              Soma&apos;s own Claude Code thread (separate from your terminal session). Try:{" "}
              <em>“log my dinner: 200g chicken breast, 150g rice, 100g broccoli”</em>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} onRetry={retry} busy={busy} />
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
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                // Paste an image → upload, append the saved path to the input
                // so the assistant can Read it.
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const it of items) {
                  if (it.kind !== "file") continue;
                  const blob = it.getAsFile();
                  if (!blob || !blob.type.startsWith("image/")) continue;
                  e.preventDefault();
                  const form = new FormData();
                  form.append("file", blob, blob.name || "pasted.png");
                  void fetch("/api/chat/upload", { method: "POST", body: form })
                    .then((r) => r.json())
                    .then((d) => {
                      if (d?.path) {
                        setInput((prev) =>
                          (prev ? prev + "\n\n" : "") + `[image: ${d.path}]`
                        );
                      }
                    })
                    .catch(() => {});
                  return;
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={busy ? "Claude is responding…" : "Message Claude… (⌘K to focus, paste an image to attach)"}
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

function MessageBubble({
  msg,
  onRetry,
  busy,
}: {
  msg: Message;
  onRetry: (prompt?: string) => void;
  busy: boolean;
}) {
  if (msg.role === "user") {
    const text = msg.steps.find((s): s is TextStep => s.kind === "text")?.text || "";
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-emerald-500/20 px-3 py-2 text-sm text-white"
          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
        >
          {text}
        </div>
      </div>
    );
  }

  const hasContent = msg.steps.length > 0;
  // Index of the latest tool step (used to auto-expand the in-flight one).
  let lastToolIdx = -1;
  msg.steps.forEach((s, i) => {
    if (s.kind === "tool") lastToolIdx = i;
  });

  return (
    <div className="flex justify-start">
      <div
        className="w-full max-w-[95%] min-w-0 space-y-2 rounded-2xl rounded-bl-sm bg-white/5 px-3 py-2 text-sm text-zinc-100"
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        {!hasContent && !msg.done && !msg.errored && (
          <ThinkingIndicator startedAt={msg.startedAt} />
        )}

        {msg.steps.map((s, i) => {
          const isLast = i === msg.steps.length - 1;
          const showCursor = isLast && !msg.done && !msg.errored && s.kind === "text";
          if (s.kind === "text") {
            return <TextStepView key={s.id} step={s} showCursor={showCursor} />;
          }
          if (s.kind === "thinking") {
            return <ThinkingStepView key={s.id} step={s} />;
          }
          return (
            <ToolStepView
              key={s.id}
              step={s}
              defaultExpanded={i === lastToolIdx && s.status === "running"}
            />
          );
        })}

        {hasContent && !msg.done && !msg.errored && (
          <StreamingFooter startedAt={msg.startedAt} />
        )}

        {msg.errored && (
          <div className="mt-1 text-xs text-rose-400">
            <div>⚠ {msg.errored}</div>
            {msg.erroredDetail && (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-rose-500/10 p-1.5 text-[10px] text-rose-200/80">
                {msg.erroredDetail}
              </pre>
            )}
            <button
              type="button"
              onClick={() => onRetry()}
              disabled={busy}
              className="mt-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
            >
              Retry
            </button>
          </div>
        )}

        {msg.done && !msg.errored && hasContent && (
          <TurnFooter msg={msg} onRegenerate={() => onRetry()} busy={busy} />
        )}
      </div>
    </div>
  );
}

function TurnFooter({
  msg,
  onRegenerate,
  busy,
}: {
  msg: Message;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const u = msg.usage;
  const dur = typeof msg.durationMs === "number" ? msg.durationMs / 1000 : null;
  const toolCount = msg.steps.filter((s) => s.kind === "tool").length;
  const parts: string[] = [];
  if (dur !== null) parts.push(`${dur < 10 ? dur.toFixed(1) : Math.round(dur)}s`);
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
  if (u) {
    const inTok = u.input_tokens ?? 0;
    const cacheW = u.cache_creation_input_tokens ?? 0;
    const cacheR = u.cache_read_input_tokens ?? 0;
    const out = u.output_tokens ?? 0;
    parts.push(
      `${inTok} in · ${cacheW ? `${formatTok(cacheW)} write` : "0 write"} · ${formatTok(cacheR)} read · ${out} out`
    );
  }
  if (parts.length === 0) return null;
  return (
    <div className="flex items-center justify-between pt-1 text-[10px] text-zinc-500">
      <span className="font-mono">{parts.join(" · ")}</span>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={busy}
        title="Regenerate (re-send the same prompt)"
        className="text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
      >
        ↻
      </button>
    </div>
  );
}

function formatTok(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

function useElapsed(startedAt: number | undefined): string {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return "";
  const s = Math.max(0, (now - startedAt) / 1000);
  return s < 10 ? s.toFixed(1) + "s" : Math.round(s) + "s";
}

function ThinkingIndicator({ startedAt }: { startedAt?: number }) {
  const elapsed = useElapsed(startedAt);
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex gap-1">
        <Dot />
        <Dot delay="120ms" />
        <Dot delay="240ms" />
      </div>
      <span className="font-mono text-[10px] text-zinc-500">
        {startedAt ? `thinking · ${elapsed}` : "thinking…"}
      </span>
    </div>
  );
}

function StreamingFooter({ startedAt }: { startedAt?: number }) {
  const elapsed = useElapsed(startedAt);
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="flex gap-1">
        <Dot />
        <Dot delay="120ms" />
        <Dot delay="240ms" />
      </div>
      <span className="font-mono text-[10px] text-zinc-500">
        {startedAt ? `streaming · ${elapsed}` : "streaming…"}
      </span>
    </div>
  );
}

function TextStepView({ step, showCursor }: { step: TextStep; showCursor?: boolean }) {
  if (!step.text && !showCursor) return null;
  const rendered = showCursor ? step.text + "​" : step.text;
  return (
    <div className="prose prose-invert prose-sm max-w-none break-words [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-zinc-900 [&_pre]:p-2 [&_table]:border [&_table]:border-white/10 [&_table]:text-xs [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:px-1.5 [&_th]:py-1 [&_td]:border [&_td]:border-white/10 [&_td]:px-1.5 [&_td]:py-1 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{rendered}</ReactMarkdown>
      {showCursor && (
        <span className="ml-0.5 inline-block h-3.5 w-[7px] -translate-y-[1px] animate-pulse bg-emerald-400/80 align-middle" />
      )}
    </div>
  );
}

function ThinkingStepView({ step }: { step: ThinkingStep }) {
  const [expanded, setExpanded] = useState(false);
  if (!step.text) return null;
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-[11px] text-zinc-500"
      >
        <span>💭</span>
        <span className="font-mono">thinking ({step.text.length} chars)</span>
        <span className="ml-auto text-[10px]">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 whitespace-pre-wrap border-t border-white/5 pt-1.5 text-[11px] italic text-zinc-400">
          {step.text}
        </div>
      )}
    </div>
  );
}

function ToolStepView({
  step,
  defaultExpanded,
}: {
  step: ToolStep;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState<boolean>(!!defaultExpanded);
  const [userToggled, setUserToggled] = useState(false);
  const [showFull, setShowFull] = useState(false);

  // Auto-collapse when a running tool completes (unless the user toggled it manually).
  useEffect(() => {
    if (userToggled) return;
    if (step.status === "running") setExpanded(true);
    else setExpanded(!!defaultExpanded);
  }, [step.status, defaultExpanded, userToggled]);

  const summary = summarizeToolInput(step.name, step.input);
  const statusColor =
    step.status === "running"
      ? "border-amber-500/40 bg-amber-500/10"
      : step.isError
        ? "border-rose-500/40 bg-rose-500/10"
        : "border-emerald-500/30 bg-emerald-500/10";
  const outputToShow =
    showFull && step.outputFull ? step.outputFull : step.output;
  return (
    <div className={`rounded-md border ${statusColor} px-2 py-1.5`}>
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
          setUserToggled(true);
        }}
        className="flex w-full items-start gap-1.5 text-left"
      >
        <span className="mt-[1px] text-xs leading-none">{toolIcon(step.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="font-mono font-medium text-zinc-200">{step.name}</span>
            {step.status === "running" && (
              <span className="font-mono text-[9px] text-amber-300">running…</span>
            )}
            {step.status === "done" && step.isError && (
              <span className="font-mono text-[9px] text-rose-300">error</span>
            )}
          </div>
          {summary && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-400" title={summary}>
              {summary}
            </div>
          )}
        </div>
        <span className="ml-1 text-[10px] text-zinc-500">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 border-t border-white/5 pt-1.5">
          {step.input && (
            <details className="text-[10px] text-zinc-400" open>
              <summary className="cursor-pointer text-zinc-500">input</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-1.5 text-[10px] text-zinc-300">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </details>
          )}
          {step.output && (
            <details className="text-[10px] text-zinc-400" open>
              <summary className="cursor-pointer text-zinc-500 flex items-center gap-2">
                <span>
                  output
                  {step.outputTruncated && !showFull
                    ? ` (truncated · ${step.outputFull.length} chars)`
                    : ""}
                </span>
                {step.outputTruncated && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setShowFull((v) => !v);
                    }}
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    {showFull ? "show less" : "show full"}
                  </button>
                )}
              </summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-1.5 text-[10px] text-zinc-300">
                {outputToShow}
              </pre>
            </details>
          )}
        </div>
      )}
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

function NewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
