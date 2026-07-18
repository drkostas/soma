import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { Text, Card, Badge, type BadgeTone } from "soma-style";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3456";

/* First-pass React Native port of the web chat-widget. Talks to the same
   /api/chat SSE endpoint (a local `claude -p` subprocess on the Mac, or the
   Vercel→cloudflared proxy). Streaming is read with expo/fetch, which exposes a
   web-standard ReadableStream on native + web. Markdown is rendered as plain text
   for now — the mobile-UI pass can add a renderer. */

type Role = "user" | "assistant";
type Step =
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      inputJson: string;
      input: Record<string, unknown> | null;
      output: string;
      isError: boolean;
      status: "running" | "done";
    };

interface Message {
  id: string;
  role: Role;
  steps: Step[];
  done: boolean;
  errored?: string;
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

function summarizeToolInput(name: string, input: Record<string, unknown> | null): string {
  if (!input) return "";
  const get = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  if (name === "Bash") return get("command") ?? "";
  if (name === "Read" || name === "Edit" || name === "Write") return get("file_path") ?? "";
  if (name === "Grep" || name === "Glob") return get("pattern") ?? "";
  if (name.startsWith("mcp__tavily")) return get("query") ?? "";
  try {
    return JSON.stringify(input).slice(0, 80);
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Streaming hook                                                      */
/* ------------------------------------------------------------------ */

function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [transport, setTransport] = useState<"unknown" | "local" | "proxy" | "offline">("unknown");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    expoFetch(`${API_BASE}/api/chat/session`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(() => setTransport(API_BASE.includes("localhost") ? "local" : "proxy"))
      .catch(() => setTransport("offline"));
    expoFetch(`${API_BASE}/api/chat/history`)
      .then((r) => r.json())
      .then((d: { messages?: Message[] }) => {
        if (Array.isArray(d.messages) && d.messages.length) setMessages(d.messages);
      })
      .catch(() => {});
  }, []);

  const send = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message) return;
    const assistantId = newId();
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "user", steps: [{ kind: "text", id: newId(), text: message }], done: true },
      { id: assistantId, role: "assistant", steps: [], done: false },
    ]);
    setBusy(true);

    const blockToStep = new Map<number, string>();
    const mutate = (fn: (m: Message) => Message) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
    const upsert = (step: Step) =>
      mutate((m) => {
        const i = m.steps.findIndex((s) => s.id === step.id);
        return {
          ...m,
          steps: i >= 0 ? m.steps.map((s) => (s.id === step.id ? step : s)) : [...m.steps, step],
        };
      });
    const update = (id: string, fn: (s: Step) => Step) =>
      mutate((m) => ({ ...m, steps: m.steps.map((s) => (s.id === id ? fn(s) : s)) }));

    const onStream = (inner: {
      type?: string;
      index?: number;
      content_block?: { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
      delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
    }) => {
      const idx = typeof inner.index === "number" ? inner.index : -1;
      if (inner.type === "content_block_start" && inner.content_block && idx >= 0) {
        const cb = inner.content_block;
        if (cb.type === "text") {
          const s: Step = { kind: "text", id: newId(), text: "" };
          blockToStep.set(idx, s.id);
          upsert(s);
        } else if (cb.type === "thinking") {
          const s: Step = { kind: "thinking", id: newId(), text: "" };
          blockToStep.set(idx, s.id);
          upsert(s);
        } else if (cb.type === "tool_use") {
          const s: Step = {
            kind: "tool",
            id: cb.id || newId(),
            name: cb.name || "tool",
            inputJson: "",
            input: cb.input && Object.keys(cb.input).length ? cb.input : null,
            output: "",
            isError: false,
            status: "running",
          };
          blockToStep.set(idx, s.id);
          upsert(s);
        }
      } else if (inner.type === "content_block_delta" && inner.delta && idx >= 0) {
        const id = blockToStep.get(idx);
        if (!id) return;
        const d = inner.delta;
        if (d.type === "text_delta" && d.text)
          update(id, (s) => (s.kind === "text" ? { ...s, text: s.text + d.text } : s));
        else if (d.type === "thinking_delta" && d.thinking)
          update(id, (s) => (s.kind === "thinking" ? { ...s, text: s.text + d.thinking } : s));
        else if (d.type === "input_json_delta" && d.partial_json)
          update(id, (s) => (s.kind === "tool" ? { ...s, inputJson: s.inputJson + d.partial_json } : s));
      } else if (inner.type === "content_block_stop" && idx >= 0) {
        const id = blockToStep.get(idx);
        if (!id) return;
        update(id, (s) => {
          if (s.kind !== "tool" || s.input) return s;
          try {
            return { ...s, input: JSON.parse(s.inputJson) as Record<string, unknown> };
          } catch {
            return s;
          }
        });
      }
    };

    const onUser = (m: { content?: Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> }) => {
      if (!Array.isArray(m.content)) return;
      for (const item of m.content) {
        if (item.type !== "tool_result" || !item.tool_use_id) continue;
        let raw2 = "";
        if (typeof item.content === "string") raw2 = item.content;
        else if (Array.isArray(item.content))
          raw2 = (item.content as Array<{ type?: string; text?: string }>)
            .filter((c) => c.type === "text" && typeof c.text === "string")
            .map((c) => c.text as string)
            .join("\n");
        update(item.tool_use_id, (s) =>
          s.kind === "tool"
            ? { ...s, status: "done", isError: !!item.is_error, output: raw2.slice(0, 600) }
            : s,
        );
      }
    };

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const resp = await expoFetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        mutate((m) => ({ ...m, done: true, errored: `HTTP ${resp.status}` }));
        return;
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const rawEvent = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let name = "message";
          let data = "";
          for (const line of rawEvent.split("\n")) {
            if (line.startsWith("event: ")) name = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;
          let parsed: { type?: string; event?: unknown; message?: unknown; error?: string; result?: string } = {};
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (name === "fatal") {
            mutate((m) => ({ ...m, done: true, errored: parsed.error || "subprocess failed" }));
          } else if (name === "done") {
            mutate((m) => ({ ...m, done: true }));
          } else if (name === "event") {
            if (parsed.type === "stream_event") onStream((parsed.event ?? {}) as never);
            else if (parsed.type === "user") onUser((parsed.message ?? {}) as never);
            else if (parsed.type === "result" && typeof parsed.result === "string" && parsed.result.length) {
              const res = parsed.result;
              mutate((m) =>
                m.steps.some((s) => s.kind === "text" && s.text.length)
                  ? m
                  : { ...m, steps: [...m.steps, { kind: "text", id: newId(), text: res }] },
              );
            }
          }
        }
      }
    } catch (err) {
      const aborted = (err as Error).name === "AbortError";
      mutate((m) => ({ ...m, done: true, errored: aborted ? "Cancelled" : String(err) }));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    setMessages([]);
    expoFetch(`${API_BASE}/api/chat/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "" }),
    }).catch(() => {});
  }, []);

  return { messages, busy, transport, send, cancel, reset };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

const TRANSPORT_TONE: Record<string, BadgeTone> = {
  local: "success",
  proxy: "teal",
  offline: "danger",
  unknown: "neutral",
};

function ToolStep({ step }: { step: Extract<Step, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(step.name, step.input);
  const tone: BadgeTone = step.status === "running" ? "warm" : step.isError ? "danger" : "success";
  return (
    <Pressable onPress={() => setOpen((v) => !v)}>
      <View className="gap-1 rounded-lg border border-border-subtle bg-surface-elevated px-2.5 py-2">
        <View className="flex-row items-center gap-2">
          <Text variant="micro" className="font-mono text-text">
            {step.name}
          </Text>
          <Badge label={step.status === "running" ? "running" : step.isError ? "error" : "done"} tone={tone} />
        </View>
        {summary ? (
          <Text variant="micro" numberOfLines={open ? undefined : 1} className="font-mono text-text-muted">
            {summary}
          </Text>
        ) : null}
        {open && step.output ? (
          <Text variant="micro" className="font-mono text-text-secondary">
            {step.output}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Bubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    const text = msg.steps.find((s) => s.kind === "text")?.text ?? "";
    return (
      <View className="items-end">
        <View className="max-w-[85%] rounded-2xl rounded-br-sm bg-teal/20 px-3 py-2">
          <Text variant="body" className="text-text">
            {text}
          </Text>
        </View>
      </View>
    );
  }
  const empty = msg.steps.length === 0;
  return (
    <View className="items-start">
      <View className="w-full max-w-[95%] gap-2 rounded-2xl rounded-bl-sm bg-surface-elevated px-3 py-2">
        {empty && !msg.done && !msg.errored ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text variant="micro" className="text-text-muted">
              thinking…
            </Text>
          </View>
        ) : null}
        {msg.steps.map((s) => {
          if (s.kind === "text")
            return s.text ? (
              <Text key={s.id} variant="body" className="text-text">
                {s.text}
              </Text>
            ) : null;
          if (s.kind === "thinking")
            return s.text ? (
              <Text key={s.id} variant="micro" className="italic text-text-muted">
                💭 {s.text}
              </Text>
            ) : null;
          return <ToolStep key={s.id} step={s} />;
        })}
        {msg.errored ? (
          <Text variant="micro" className="text-danger">
            ⚠ {msg.errored}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet + floating button                                             */
/* ------------------------------------------------------------------ */

export function ChatSheet() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, busy, transport, send, cancel, reset } = useChat();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages, open]);

  const submit = () => {
    const m = input.trim();
    if (!m || busy) return;
    setInput("");
    void send(m);
  };

  return (
    <>
      {!open ? (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityLabel="Open chat"
          className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-teal shadow-lg"
        >
          <Text variant="title" className="text-ink">
            ✦
          </Text>
        </Pressable>
      ) : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 justify-end"
        >
          <View className="h-[88%] rounded-t-3xl border-t border-border bg-base">
            {/* Header */}
            <View className="flex-row items-center justify-between border-b border-border-subtle px-4 py-3">
              <View className="flex-row items-center gap-2">
                <Text variant="title" className="text-text">
                  Claude
                </Text>
                <Badge label={transport} tone={TRANSPORT_TONE[transport] ?? "neutral"} />
              </View>
              <View className="flex-row items-center gap-4">
                <Pressable onPress={reset} disabled={busy} accessibilityLabel="New conversation">
                  <Text variant="caption" className="text-text-muted">
                    New
                  </Text>
                </Pressable>
                <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close chat">
                  <Text variant="caption" className="text-text-muted">
                    Close
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Messages */}
            <ScrollView ref={scrollRef} className="flex-1 px-4" contentContainerClassName="gap-3 py-4">
              {messages.length === 0 ? (
                <Card>
                  <Text variant="caption" className="text-text-secondary">
                    Soma&apos;s own Claude Code thread. Try: “log my dinner: 200g chicken breast, 150g
                    rice, 100g broccoli”.
                  </Text>
                </Card>
              ) : null}
              {messages.map((m) => (
                <Bubble key={m.id} msg={m} />
              ))}
            </ScrollView>

            {/* Composer */}
            <View className="flex-row items-end gap-2 border-t border-border-subtle px-3 py-3">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={busy ? "Claude is responding…" : "Message Claude…"}
                placeholderTextColor="#7a7f8a"
                multiline
                editable={!busy}
                onSubmitEditing={submit}
                className="max-h-28 flex-1 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-base text-text"
                style={{ color: "#e6e9ef" }}
              />
              {busy ? (
                <Pressable onPress={cancel} className="rounded-xl bg-danger/20 px-4 py-2.5">
                  <Text variant="caption" className="text-danger">
                    Stop
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={submit}
                  disabled={!input.trim()}
                  className={`rounded-xl px-4 py-2.5 ${input.trim() ? "bg-teal" : "bg-surface-elevated"}`}
                >
                  <Text variant="caption" className={input.trim() ? "text-ink" : "text-text-muted"}>
                    Send
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
