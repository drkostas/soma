import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sql = getDb();
  await sql`DELETE FROM pump_up_songs WHERE track_id = ${id}`;
  return NextResponse.json({ ok: true });
}
