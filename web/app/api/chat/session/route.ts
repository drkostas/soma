import { NextRequest, NextResponse } from "next/server";
import { readChatConfig, writeChatConfig } from "@/lib/chat-config";
import { chatMode, proxyToLocal, requireToken } from "@/lib/chat-transport";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (chatMode() === "proxy") return proxyToLocal(req, "/api/chat/session");
  const denied = requireToken(req);
  if (denied) return denied;
  const cfg = await readChatConfig();
  // Augment with the server's mode so the widget can show a status dot.
  return NextResponse.json({ ...cfg, mode: "local" });
}

export async function PUT(req: NextRequest) {
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
