import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bpmMin = parseFloat(sp.get("bpm_min") ?? "0");
  const bpmMax = parseFloat(sp.get("bpm_max") ?? "300");
  const bpmTol = parseFloat(sp.get("bpm_tol") ?? "8");
  const energyMin = parseFloat(sp.get("energy_min") ?? "0");
  const valenceMin = parseFloat(sp.get("valence_min") ?? "0");
  const valenceMax = parseFloat(sp.get("valence_max") ?? "1");
  const genres = sp.get("genres")?.split(",").filter(Boolean) ?? [];
  const halfTime = sp.get("half_time") === "true";
  const excludeParam = sp.get("exclude");
  const excludeIds = excludeParam ? excludeParam.split(",").filter(Boolean) : [];

  const sql = getDb();
  const lo = bpmMin - bpmTol;
  const hi = bpmMax + bpmTol;

  let rows;
  if (halfTime) {
    rows = await sql`
      SELECT * FROM spotify_track_features
      WHERE (
        (tempo BETWEEN ${lo} AND ${hi})
        OR (tempo BETWEEN ${lo / 2} AND ${hi / 2})
      )
      AND energy >= ${energyMin}
      AND valence BETWEEN ${valenceMin} AND ${valenceMax}
      ${genres.length > 0 ? sql`AND genres && ${genres}` : sql``}
      ${excludeIds.length > 0 ? sql`AND track_id != ALL(${excludeIds})` : sql``}
      AND track_id NOT IN (SELECT track_id FROM user_blacklist)
      ORDER BY tempo
      LIMIT 500
    `;
  } else {
    rows = await sql`
      SELECT * FROM spotify_track_features
      WHERE tempo BETWEEN ${lo} AND ${hi}
      AND energy >= ${energyMin}
      AND valence BETWEEN ${valenceMin} AND ${valenceMax}
      ${genres.length > 0 ? sql`AND genres && ${genres}` : sql``}
      ${excludeIds.length > 0 ? sql`AND track_id != ALL(${excludeIds})` : sql``}
      AND track_id NOT IN (SELECT track_id FROM user_blacklist)
      ORDER BY tempo
      LIMIT 500
    `;
  }
  return NextResponse.json(rows);
}
