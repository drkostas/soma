import { NextRequest, NextResponse } from "next/server";
import { join } from "node:path";
import { readChatConfig } from "@/lib/chat-config";
import { hydrateFromJsonl } from "@/lib/chat-history";
import { chatMode, chatGone, chatPreflight, proxyToLocal, requireToken, withCors } from "@/lib/chat-transport";

export const runtime = "nodejs";

function repoRoot(): string {
  return join(process.cwd(), "..");
}

async function getImpl(req: NextRequest) {
  if (chatMode() === "gone") return chatGone();
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

/** CORS preflight for the browser calling the Mac directly over the tailnet (#670). */
export function OPTIONS(req: NextRequest) {
  return chatPreflight(req);
}

export async function GET(req: NextRequest) {
  return withCors(req, await getImpl(req));
}
