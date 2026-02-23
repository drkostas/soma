import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sql = getDb();
  const { id } = await params;
  try {
    const body = await req.json();
    if ("enabled" in body) {
      const rows = await sql`
        UPDATE sync_rules SET enabled = ${body.enabled} WHERE id = ${Number(id)}
        RETURNING id, source_platform, activity_type, destinations, enabled, priority
      `;
      if (rows.length === 0) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
      return NextResponse.json({ rule: rows[0] });
    }
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  } catch (err) {
    console.error("Error updating rule:", err);
    return NextResponse.json({ error: "Failed to update rule" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sql = getDb();
  const { id } = await params;
  try {
    const rows = await sql`DELETE FROM sync_rules WHERE id = ${Number(id)} RETURNING id`;
    if (rows.length === 0) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Error deleting rule:", err);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
