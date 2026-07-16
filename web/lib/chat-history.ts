/**
 * Hydrate chat history from a Claude Code session's on-disk JSONL.
 *
 * The JSONL files live at:
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *
 * Encoding: every '/' in the cwd path becomes '-' and the leading '/' is
 * replaced with '-' as well, so /Users/gkos/Insync/Gdrive/Projects/soma
 * becomes -Users-gkos-Insync-Gdrive-Projects-soma.
 *
 * Each line is one event. We care about a subset:
 *   - `message-start` with `role: "user"`  → start a new user message
 *   - `message-start` with `role: "assistant"` → start a new assistant turn
 *   - `text` / `thinking` events with content → append to current message
 *   - `tool_use` / `tool_result` → append tool steps to current assistant
 *
 * The shape returned matches the client's Message[] so the widget can drop
 * it straight into state.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export type HydratedRole = "user" | "assistant";

export interface HydratedTextStep {
  kind: "text";
  id: string;
  text: string;
}
export interface HydratedThinkingStep {
  kind: "thinking";
  id: string;
  text: string;
}
export interface HydratedToolStep {
  kind: "tool";
  id: string;
  name: string;
  inputJson: string;
  input: Record<string, unknown> | null;
  output: string;
  outputFull: string;
  outputTruncated: boolean;
  isError: boolean;
  status: "done";
}
export type HydratedStep = HydratedTextStep | HydratedThinkingStep | HydratedToolStep;

export interface HydratedMessage {
  id: string;
  role: HydratedRole;
  userPrompt?: string;
  steps: HydratedStep[];
  done: true;
}

function encodeCwd(p: string): string {
  // /Users/gkos/x → -Users-gkos-x
  return p.replace(/\//g, "-");
}

export function sessionJsonlPath(sessionId: string, repoRoot: string): string {
  const dir = join(homedir(), ".claude", "projects", encodeCwd(repoRoot));
  return join(dir, `${sessionId}.jsonl`);
}

interface RawLine {
  type?: string;
  // Most relevant fields differ per event — keep loose typing.
  role?: string;
  content?: unknown;
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  text?: string;
  thinking?: string;
  is_error?: boolean;
  uuid?: string;
}

function truncate(s: string, n = 800) {
  if (s.length <= n) return { text: s, truncated: false };
  return { text: s.slice(0, n), truncated: true };
}

function newId(prefix: string, i: number) {
  return `${prefix}${i.toString(36)}`;
}

/**
 * Parse a session JSONL into Message[] suitable for client hydration. Best-
 * effort: unknown event types are skipped. Returns at most `limit` messages
 * (most recent first kept).
 */
export async function hydrateFromJsonl(
  sessionId: string,
  repoRoot: string,
  limit = 80
): Promise<HydratedMessage[]> {
  const path = sessionJsonlPath(sessionId, repoRoot);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const messages: HydratedMessage[] = [];
  let current: HydratedMessage | null = null;
  // Map tool_use_id → step so tool_result events can find their target.
  const toolById = new Map<string, HydratedToolStep>();
  let stepCounter = 0;

  const flush = () => {
    if (current && (current.steps.length > 0 || current.userPrompt)) {
      messages.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    let e: RawLine;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const t = e.type;
    if (!t) continue;

    // A new user or assistant turn begins. The actual content is on
    // subsequent lines (text / tool_use / etc.) of the same type.
    if (t === "user") {
      // The 'user' lines in the JSONL also include tool_results (content =
      // an array of tool_result blocks). Distinguish by content shape.
      if (Array.isArray(e.content)) {
        // First check if it's a tool_result batch — common between assistant turns.
        const toolResults = (e.content as Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }>).filter(
          (c) => c.type === "tool_result"
        );
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            const target = tr.tool_use_id ? toolById.get(tr.tool_use_id) : null;
            if (!target) continue;
            let outRaw = "";
            if (typeof tr.content === "string") outRaw = tr.content;
            else if (Array.isArray(tr.content)) {
              outRaw = (tr.content as Array<{ type?: string; text?: string }>)
                .filter((c) => c.type === "text" && typeof c.text === "string")
                .map((c) => c.text as string)
                .join("\n");
            }
            const { text, truncated } = truncate(outRaw);
            target.output = text;
            target.outputFull = outRaw;
            target.outputTruncated = truncated;
            target.isError = !!tr.is_error;
            target.status = "done";
          }
          continue;
        }
        // Otherwise it's a multi-block user message — fall through and treat
        // it as a fresh user turn whose text we'll capture below.
      }
      flush();
      current = {
        id: newId("u", messages.length),
        role: "user",
        steps: [],
        done: true,
      };
      // Single-string content is the user's actual prompt.
      if (typeof e.content === "string" && e.content.length > 0) {
        current.userPrompt = e.content;
        current.steps.push({
          kind: "text",
          id: newId("ut", stepCounter++),
          text: e.content,
        });
      } else if (Array.isArray(e.content)) {
        // Concatenate any text-type blocks.
        const text = (e.content as Array<{ type?: string; text?: string }>)
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("\n");
        if (text) {
          current.userPrompt = text;
          current.steps.push({
            kind: "text",
            id: newId("ut", stepCounter++),
            text,
          });
        }
      }
      continue;
    }

    if (t === "assistant") {
      flush();
      current = {
        id: newId("a", messages.length),
        role: "assistant",
        steps: [],
        done: true,
      };
      continue;
    }

    // Content blocks within the current turn.
    if (t === "text" && typeof e.text === "string" && current) {
      current.steps.push({
        kind: "text",
        id: newId("t", stepCounter++),
        text: e.text,
      });
      continue;
    }

    if (t === "thinking" && typeof e.thinking === "string" && current) {
      current.steps.push({
        kind: "thinking",
        id: newId("th", stepCounter++),
        text: e.thinking,
      });
      continue;
    }

    if (t === "tool_use" && current && current.role === "assistant") {
      const id = typeof e.uuid === "string" ? e.uuid : newId("tool", stepCounter++);
      const input =
        e.input && typeof e.input === "object" && !Array.isArray(e.input)
          ? (e.input as Record<string, unknown>)
          : null;
      const step: HydratedToolStep = {
        kind: "tool",
        id,
        name: typeof e.name === "string" ? e.name : "tool",
        inputJson: "",
        input,
        output: "",
        outputFull: "",
        outputTruncated: false,
        isError: false,
        status: "done",
      };
      current.steps.push(step);
      toolById.set(id, step);
      continue;
    }
  }
  flush();

  // Keep only the last `limit` messages.
  return messages.slice(-limit);
}
