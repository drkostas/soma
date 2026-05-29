import { NextRequest, NextResponse } from "next/server";
import { join } from "node:path";
import { readChatConfig } from "@/lib/chat-config";
import { hydrateFromJsonl } from "@/lib/chat-history";
import { chatMode, proxyToLocal, requireToken } from "@/lib/chat-transport";

export const runtime = "nodejs";

function repoRoot(): string {
  return join(process.cwd(), "..");
}

export async function GET(req: NextRequest) {
  if (chatMode() === "proxy") return proxyToLocal(req, "/api/chat/history");
  const denied = requireToken(req);
  if (denied) return denied;
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
