import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_PATH = join(homedir(), ".soma", "chat.json");

// Hardcoded fallback: the live terminal session for soma at the time this
// feature was built. If the user blows away ~/.soma/chat.json they'll get
// back to this thread.
const DEFAULT_SESSION_ID = "da2bc3f0-e985-4ca2-aa67-c841e9212fbc";

export interface ChatConfig {
  sessionId: string;
}

export async function readChatConfig(): Promise<ChatConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatConfig>;
    if (typeof parsed.sessionId === "string" && parsed.sessionId.length > 0) {
      return { sessionId: parsed.sessionId };
    }
  } catch {
    // file missing or unreadable: fall through to default
  }
  return { sessionId: DEFAULT_SESSION_ID };
}

export async function writeChatConfig(cfg: ChatConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
