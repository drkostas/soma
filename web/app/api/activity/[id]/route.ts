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

  // Extract time-series from details endpoint
  const detailsRow = data["details"];
  let timeSeries: Array<{
    elapsed_sec: number;
    hr: number | null;
    speed: number | null;
    elevation: number | null;
    cadence: number | null;
    power: number | null;
    respiration: number | null;
    stride: number | null;
    lat: number | null;
    lng: number | null;
    dist_m: number | null;
  }> = [];

  if (
    detailsRow?.metricDescriptors &&
    detailsRow?.activityDetailMetrics
  ) {
    const descriptors = detailsRow.metricDescriptors as Array<{
      key: string;
      metricsIndex: number;
    }>;
    const metrics = detailsRow.activityDetailMetrics as Array<{
      metrics: number[];
    }>;

    // Build key -> metricsIndex lookup
    const keyIndex: Record<string, number> = {};
    for (const desc of descriptors) {
      keyIndex[desc.key] = desc.metricsIndex;
    }

    const tsIdx = keyIndex["directTimestamp"];
    const hrIdx = keyIndex["directHeartRate"];
    const speedIdx = keyIndex["directSpeed"];
    const elevIdx = keyIndex["directElevation"];
    const cadIdx = keyIndex["directDoubleCadence"];
    const powerIdx = keyIndex["directPower"];
    const respIdx = keyIndex["directRespirationRate"];
    const strideIdx = keyIndex["directStrideLength"];
    const latIdx = keyIndex["directLatitude"];
    const lngIdx = keyIndex["directLongitude"];
    const distIdx = keyIndex["sumDistance"];

    let startTs: number | null = null;

    for (const point of metrics) {
      const m = point.metrics;
      if (!m) continue;

      const ts = tsIdx != null ? m[tsIdx] : null;
      if (startTs === null && ts != null) startTs = ts;

      const elapsedSec =
        startTs != null && ts != null
          ? Math.round((ts - startTs) / 1000)
          : null;
      if (elapsedSec == null || elapsedSec < 0) continue;

      timeSeries.push({
        elapsed_sec: elapsedSec,
        hr: hrIdx != null ? m[hrIdx] ?? null : null,
        speed: speedIdx != null ? m[speedIdx] ?? null : null,
        elevation: elevIdx != null ? m[elevIdx] ?? null : null,
        cadence: cadIdx != null ? m[cadIdx] ?? null : null,
        power: powerIdx != null ? m[powerIdx] ?? null : null,
        respiration: respIdx != null ? m[respIdx] ?? null : null,
        stride: strideIdx != null ? m[strideIdx] ?? null : null,
        lat: latIdx != null ? m[latIdx] ?? null : null,
        lng: lngIdx != null ? m[lngIdx] ?? null : null,
        dist_m: distIdx != null ? m[distIdx] ?? null : null,
      });
    }
  }

  // Build GPS route array for map rendering
  const gpsRoute = timeSeries
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({
      lat: p.lat as number,
      lng: p.lng as number,
      hr: p.hr,
      speed: p.speed,
      elev: p.elevation,
      cadence: p.cadence,
      dist_m: p.dist_m,
    }));

  return NextResponse.json({ ...data, time_series: timeSeries, gps_route: gpsRoute });
}
