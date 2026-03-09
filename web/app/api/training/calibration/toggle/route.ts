import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { forceEqual } = body;

    if (typeof forceEqual !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "forceEqual must be a boolean" },
        { status: 400 },
      );
    }

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
