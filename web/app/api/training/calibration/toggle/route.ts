import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { forceEqual } = await request.json();
    const sql = getDb();

    await sql`
      UPDATE calibration_state SET force_equal = ${forceEqual}, updated_at = NOW()
      WHERE id = 1
    `;

    return NextResponse.json({ ok: true, forceEqual });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
