import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  const sql = getDb();
  await sql`DELETE FROM platform_credentials WHERE platform = 'spotify'`;
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/connections`);
}
