import { NextRequest, NextResponse } from "next/server";
import { readChatConfig, writeChatConfig } from "@/lib/chat-config";
import { chatMode, chatGone, chatPreflight, proxyToLocal, requireToken, withCors } from "@/lib/chat-transport";

export const runtime = "nodejs";

async function getImpl(req: NextRequest) {
  if (chatMode() === "gone") return chatGone();
  if (chatMode() === "proxy") return proxyToLocal(req, "/api/chat/session");
  const denied = requireToken(req);
  if (denied) return denied;
  const cfg = await readChatConfig();
  // Augment with the server's mode so the widget can show a status dot.
  return NextResponse.json({ ...cfg, mode: "local" });
}

async function putImpl(req: NextRequest) {
  if (chatMode() === "gone") return chatGone();
  if (chatMode() === "proxy") return proxyToLocal(req, "/api/chat/session");
  const denied = requireToken(req);
  if (denied) return denied;
  const body = (await req.json()) as { sessionId?: unknown };
  if (typeof body.sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId (string) is required" },
      { status: 400 }
    );
  }
  // Empty string is allowed and means "reset — bootstrap a fresh session on
  // the next /api/chat call".
  await writeChatConfig({ sessionId: body.sessionId });
  return NextResponse.json({ sessionId: body.sessionId });
}

/** CORS preflight for the browser calling the Mac directly over the tailnet (#670). */
export function OPTIONS(req: NextRequest) {
  return chatPreflight(req);
}

export async function GET(req: NextRequest) {
  return withCors(req, await getImpl(req));
}

export async function PUT(req: NextRequest) {
  return withCors(req, await putImpl(req));
}
