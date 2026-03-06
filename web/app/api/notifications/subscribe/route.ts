import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const sql = getDb();
  const { endpoint, keys, userAgent } = await req.json();

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: "Missing subscription data" }, { status: 400 });
  }

  await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
    VALUES (${endpoint}, ${keys.p256dh}, ${keys.auth}, ${userAgent || null})
    ON CONFLICT (endpoint)
    DO UPDATE SET p256dh = ${keys.p256dh}, auth = ${keys.auth}, last_used_at = NOW()
  `;

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sql = getDb();
  const { endpoint } = await req.json();

  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
  return NextResponse.json({ ok: true });
}
