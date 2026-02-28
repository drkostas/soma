// web/app/api/playlist/spotify/token/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sql = getDb();
  const rows = await sql`SELECT credentials FROM platform_credentials WHERE platform = 'spotify'`;
  if (!rows[0]) return NextResponse.json({ error: "Not connected" }, { status: 401 });
  const creds = rows[0].credentials as { access_token: string };
  return NextResponse.json({ token: creds.access_token });
}
