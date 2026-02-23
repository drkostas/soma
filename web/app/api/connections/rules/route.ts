import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET() {
  const sql = getDb();
  try {
    const rules = await sql`
      SELECT id, source_platform, activity_type, preprocessing, destinations, enabled, priority, created_at
      FROM sync_rules ORDER BY priority DESC, id
    `;
    return NextResponse.json({ rules });
  } catch (err) {
    console.error("Error fetching rules:", err);
    return NextResponse.json({ error: "Failed to fetch rules" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sql = getDb();
  try {
    const body = await req.json();
    const { source_platform, activity_type, preprocessing, destinations, enabled, priority } = body;
    if (!source_platform || !destinations) {
      return NextResponse.json({ error: "source_platform and destinations are required" }, { status: 400 });
    }
    const rows = await sql`
      INSERT INTO sync_rules (source_platform, activity_type, preprocessing, destinations, enabled, priority)
      VALUES (${source_platform}, ${activity_type || "*"}, ${preprocessing || []}, ${JSON.stringify(destinations)}::jsonb, ${enabled !== false}, ${priority || 0})
      RETURNING id, source_platform, activity_type, preprocessing, destinations, enabled, priority
    `;
    return NextResponse.json({ rule: rows[0] }, { status: 201 });
  } catch (err) {
    console.error("Error creating rule:", err);
    return NextResponse.json({ error: "Failed to create rule" }, { status: 500 });
  }
}
