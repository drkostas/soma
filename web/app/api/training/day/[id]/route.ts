import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const sql = getDb();

  if (body.garmin_push_status !== undefined) {
    await sql`
      UPDATE training_plan_day
      SET garmin_push_status = ${body.garmin_push_status}
      WHERE id = ${Number(id)}
    `;
  }

  if (body.completed !== undefined) {
    await sql`
      UPDATE training_plan_day
      SET completed = ${body.completed},
          actual_distance_km = ${body.actual_distance_km ?? null},
          actual_duration_min = ${body.actual_duration_min ?? null}
      WHERE id = ${Number(id)}
    `;
  }

  return NextResponse.json({ ok: true });
}
