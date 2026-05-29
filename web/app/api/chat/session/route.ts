import { NextRequest, NextResponse } from "next/server";
import { readChatConfig, writeChatConfig } from "@/lib/chat-config";

export const runtime = "nodejs";

export async function GET() {
  const cfg = await readChatConfig();
  return NextResponse.json(cfg);
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { sessionId?: unknown };
  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return NextResponse.json(
      { error: "sessionId (string) is required" },
      { status: 400 }
    );
  }
  await writeChatConfig({ sessionId: body.sessionId });
  return NextResponse.json({ sessionId: body.sessionId });
}
