"use client";

import { useState } from "react";
import { ActivityDetailModal } from "./activity-detail-modal";
import { WorkoutDetailModal } from "./workout-detail-modal";
import {
  Footprints,
  Dumbbell,
  Wind,
  Snowflake,
  Mountain,
  Activity,
} from "lucide-react";

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  running: <Footprints className="h-3.5 w-3.5 text-green-400" />,
  strength_training: <Dumbbell className="h-3.5 w-3.5 text-orange-400" />,
  kiteboarding_v2: <Wind className="h-3.5 w-3.5 text-cyan-400" />,
  wind_kite_surfing: <Wind className="h-3.5 w-3.5 text-cyan-400" />,
  resort_snowboarding: <Snowflake className="h-3.5 w-3.5 text-blue-300" />,
  resort_skiing_snowboarding_ws: <Snowflake className="h-3.5 w-3.5 text-blue-300" />,
  hiking: <Mountain className="h-3.5 w-3.5 text-green-400" />,
};

interface RecentActivity {
  type_key: string;
  date: string;
  name: string;
  distance_km: number;
  duration_min: number;
  calories: number | null;
  // One of these will be set depending on source
  activity_id?: string;
  workout_id?: string;
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ClickableRecentActivity({ activities }: { activities: RecentActivity[] }) {
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-3">
        {activities.map((a, i) => {
          const icon = ACTIVITY_ICONS[a.type_key] || <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
          const isGym = a.type_key === "strength_training";
          return (
            <div
              key={i}
              className="flex items-center gap-3 text-sm cursor-pointer hover:bg-accent/20 -mx-2 px-2 py-1 rounded transition-colors"
              onClick={() => {
                if (isGym && a.workout_id) {
                  setSelectedWorkoutId(a.workout_id);
                } else if (a.activity_id) {
                  setSelectedActivityId(a.activity_id);
                }
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted shrink-0">
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.name}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(a.date).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                <div>{a.distance_km.toFixed(1)} km</div>
                <div>{formatDuration(a.duration_min)}</div>
              </div>
              {a.calories && (
                <div className="text-xs text-muted-foreground w-14 text-right shrink-0">
                  {Math.round(a.calories)} cal
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ActivityDetailModal activityId={selectedActivityId} onClose={() => setSelectedActivityId(null)} />
      <WorkoutDetailModal workoutId={selectedWorkoutId} onClose={() => setSelectedWorkoutId(null)} />
    </>
  );
}
