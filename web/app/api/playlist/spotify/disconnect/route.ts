import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// Personal dashboard: no session auth. Deletes Spotify credentials for the single user.
export async function POST() {
  const sql = getDb();
  await sql`DELETE FROM platform_credentials WHERE platform = 'spotify'`;
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3456"}/connections`);
}
