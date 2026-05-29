import { NextResponse } from "next/server";
import { join } from "node:path";
import { readChatConfig } from "@/lib/chat-config";
import { hydrateFromJsonl } from "@/lib/chat-history";

export const runtime = "nodejs";

function repoRoot(): string {
  return join(process.cwd(), "..");
}

export async function GET() {
  try {
    const cfg = await readChatConfig();
    if (!cfg.sessionId) {
      return NextResponse.json({ sessionId: "", messages: [] });
    }
    const messages = await hydrateFromJsonl(cfg.sessionId, repoRoot());
    return NextResponse.json({ sessionId: cfg.sessionId, messages });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), messages: [] },
      { status: 500 }
    );
  }
}
