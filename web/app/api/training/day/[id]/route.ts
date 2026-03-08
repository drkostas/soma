import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const sql = getDb();

  await sql`
    UPDATE training_plan_day
    SET completed = ${body.completed ?? true},
        actual_distance_km = ${body.actual_distance_km ?? null},
        actual_duration_min = ${body.actual_duration_min ?? null}
    WHERE id = ${Number(id)}
  `;

  return NextResponse.json({ ok: true });
}
