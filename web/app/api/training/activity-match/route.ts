import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const sql = getDb();

    // Get active plan days
    const planDays = await sql`
      SELECT d.id, d.day_date::text as day_date, d.run_type, d.target_distance_km,
             d.workout_steps, d.completed
      FROM training_plan_day d
      JOIN training_plan p ON d.plan_id = p.id
      WHERE p.status = 'active'
      ORDER BY d.day_date
    `.catch(() => []);

    if (planDays.length === 0) return NextResponse.json([]);

    // Get Garmin activities for the plan date range
    const minDate = planDays[0].day_date;
    const maxDate = planDays[planDays.length - 1].day_date;

    const activities = await sql`
      SELECT (raw_json->>'startTimeLocal')::date::text as date, raw_json as data
      FROM garmin_activity_raw
      WHERE endpoint_name = 'summary'
        AND (raw_json->>'startTimeLocal')::date BETWEEN ${minDate} AND ${maxDate}
      ORDER BY (raw_json->>'startTimeLocal')::date
    `.catch(() => []);

    // Match activities to plan days
    const matches = planDays.map((day: any) => {
      const dayActivities = activities.filter((a: any) => a.date === day.day_date);
      const runActivities = dayActivities.filter((a: any) => {
        const type = (a.data?.activityType?.typeKey || "").toLowerCase();
        return ["running", "trail_running", "treadmill_running"].includes(type);
      });

      const matched = runActivities.length > 0 ? runActivities[0] : null;
      const data = matched?.data || {};

      // Compute completion score
      let completionScore: number | null = null;
      if (matched && day.target_distance_km) {
        const actualDist = (data.distance || 0) / 1000;
        const distScore = Math.max(
          0,
          100 * (1 - Math.abs(1 - actualDist / day.target_distance_km) * 3.33),
        );

        // Pace score if workout has pace targets
        let paceScore = 100;
        if (day.workout_steps && Array.isArray(day.workout_steps)) {
          const paceSteps = day.workout_steps.filter(
            (s: any) => s.target_pace || s.target_pace_min || s.target_pace_low,
          );
          if (paceSteps.length > 0 && data.averageSpeed) {
            const actualPace = 1000 / data.averageSpeed; // sec/km
            const s = paceSteps[0];
            const targetPace = s.target_pace || s.target_pace_min || s.target_pace_low;
            const dev = Math.abs(actualPace - targetPace) / targetPace;
            paceScore = Math.max(0, 100 * (1 - dev * 5));
          }
        }

        completionScore = Math.round(
          paceScore * 0.5 + distScore * 0.3 + 100 * 0.2,
        ); // HR always 100 for now
      }

      return {
        dayId: day.id,
        dayDate: day.day_date,
        matched: matched !== null,
        completionScore,
        activity: matched
          ? {
              distance_km: ((data.distance || 0) / 1000).toFixed(2),
              duration_min: ((data.duration || 0) / 60).toFixed(1),
              avg_pace_sec_km: data.averageSpeed
                ? Math.round(1000 / data.averageSpeed)
                : null,
              avg_hr: data.averageHR || data.avgHr || null,
              max_hr: data.maxHR || data.maxHr || null,
              calories: data.calories || null,
              garmin_id: data.activityId || null,
            }
          : null,
      };
    });

    return NextResponse.json(matches);
  } catch {
    return NextResponse.json([]);
  }
}
