import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sql = getDb();

  const rows = await sql`
    SELECT endpoint_name, raw_json
    FROM garmin_activity_raw
    WHERE activity_id = ${id}
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: Record<string, any> = {};
  for (const row of rows) {
    data[row.endpoint_name] = row.raw_json;
  }

  return NextResponse.json(data);
}
