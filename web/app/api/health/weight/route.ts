import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { readTz } from "@/lib/athlete-tz";
import { acceptWeight, type IncomingWeight } from "@/lib/weight-reading";


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30", 10);

  const sql = getDb();

  const rows = await sql`
    SELECT date, weight_grams / 1000.0 as weight_kg, bmi, body_fat_pct
    FROM weight_log
    WHERE date >= CURRENT_DATE - ${days}::int
    ORDER BY date ASC
  `;

  return NextResponse.json(rows);
}


/**
 * Weigh-ins from the phone, read out of Health Connect.
 *
 * ⛔ IT MUST BE SAFE TO SEND THE SAME RECORD FOR EVER. A background task on the phone re-reads
 * Health Connect every time it runs and has no memory of what it sent, which is what makes it
 * reliable: it cannot lose a reading by forgetting. So the cost of that is borne here, with
 * `ON CONFLICT DO NOTHING` against Health Connect's own record id.
 *
 * ⚠️ NO TARGET ON THE CONFLICT, deliberately. Two unique keys can fire: the new partial index on
 * `external_id`, and the older `UNIQUE (date, weight_grams)` which predates this. A targeted
 * clause can only name one of them, and the untargeted form catches either.
 *
 * Pushing outward to Garmin and Strava is NOT done here. A reading he has taken must land even if
 * Garmin is down, so the row is stored first and the sync retries the push until it sticks.
 */
export async function POST(request: NextRequest) {
  const sql = getDb();
  let body: { readings?: IncomingWeight[]; tz?: string };
  try {
    body = (await request.json()) as { readings?: IncomingWeight[]; tz?: string };
  } catch {
    return NextResponse.json({ error: "expected JSON with a `readings` array" }, { status: 400 });
  }

  const tz = readTz(body.tz);
  const readings = Array.isArray(body.readings) ? body.readings.slice(0, 200) : [];
  if (!readings.length) return NextResponse.json({ error: "no readings" }, { status: 400 });

  let stored = 0;
  let already = 0;
  const refused: string[] = [];

  for (const r of readings) {
    const v = acceptWeight(r, tz);
    if (!v.ok) {
      refused.push(v.why);
      continue;
    }
    const w = v.row;
    const rows = (await sql`
      INSERT INTO weight_log (date, weight_grams, bmi, body_fat_pct, body_water_pct,
                              bone_mass_grams, muscle_mass_grams, source_type,
                              external_id, measured_at)
      VALUES (${w.date}, ${w.weightGrams}, ${w.bmi}, ${w.bodyFatPct}, ${w.bodyWaterPct},
              ${w.boneMassGrams}, ${w.muscleMassGrams}, ${w.sourceType},
              ${w.externalId}, ${w.measuredAt})
      ON CONFLICT DO NOTHING
      RETURNING id`) as Array<{ id: number }>;
    if (rows.length) stored++;
    else already++;
  }

  return NextResponse.json({ stored, already, refused });
}
