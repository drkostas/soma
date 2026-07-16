import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function configPath(): string {
  // Resolved on each call so tests can swap homedir() between calls.
  return join(homedir(), ".soma", "chat.json");
}

export interface ChatConfig {
  // Empty string means "no session yet — the next /api/chat call will spawn a
  // fresh `claude -p`, capture its result.session_id, and persist it here.
  sessionId: string;
}

export async function readChatConfig(): Promise<ChatConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatConfig>;
    if (typeof parsed.sessionId === "string") {
      return { sessionId: parsed.sessionId };
    }
  } catch {
    // file missing or unreadable: bootstrap with an empty session
  }
  return { sessionId: "" };
}

export async function writeChatConfig(cfg: ChatConfig): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(cfg, null, 2), "utf8");
}
