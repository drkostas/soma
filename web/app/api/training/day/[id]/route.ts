import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const VALID_PUSH_STATUSES = new Set(["none", "pending", "pushed", "success", "failed", "error"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId < 1) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const body = await request.json();
  const sql = getDb();

  if (body.garmin_push_status !== undefined) {
    if (!VALID_PUSH_STATUSES.has(body.garmin_push_status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    await sql`
      UPDATE training_plan_day
      SET garmin_push_status = ${body.garmin_push_status}
      WHERE id = ${numId}
    `;
  }

  if (body.completed !== undefined) {
    await sql`
      UPDATE training_plan_day
      SET completed = ${Boolean(body.completed)},
          actual_distance_km = ${body.actual_distance_km != null ? Number(body.actual_distance_km) : null},
          actual_duration_min = ${body.actual_duration_min != null ? Number(body.actual_duration_min) : null}
      WHERE id = ${numId}
    `;
  }

  return NextResponse.json({ ok: true });
}
