import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sql = getDb();
  await sql`DELETE FROM workout_plans WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action;

  const sql = getDb();

  if (action === "push-garmin") {
    // Mark as pending — sync engine will push on next run
    const [row] = await sql`
      UPDATE workout_plans
      SET garmin_push_status = 'pending', updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, garmin_push_status
    `;
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, status: "pending", plan: row });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
