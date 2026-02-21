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
  Bike,
  Waves,
  PersonStanding,
  Heart,
} from "lucide-react";

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  running: <Footprints className="h-3.5 w-3.5 text-green-400" />,
  strength_training: <Dumbbell className="h-3.5 w-3.5 text-orange-400" />,
  kiteboarding_v2: <Wind className="h-3.5 w-3.5 text-cyan-400" />,
  wind_kite_surfing: <Wind className="h-3.5 w-3.5 text-cyan-400" />,
  resort_snowboarding: <Snowflake className="h-3.5 w-3.5 text-blue-300" />,
  resort_skiing_snowboarding_ws: <Snowflake className="h-3.5 w-3.5 text-blue-300" />,
  hiking: <Mountain className="h-3.5 w-3.5 text-green-400" />,
  walking: <PersonStanding className="h-3.5 w-3.5 text-emerald-400" />,
  cycling: <Bike className="h-3.5 w-3.5 text-yellow-400" />,
  e_bike_fitness: <Bike className="h-3.5 w-3.5 text-yellow-400" />,
  lap_swimming: <Waves className="h-3.5 w-3.5 text-blue-400" />,
  indoor_cardio: <Heart className="h-3.5 w-3.5 text-red-400" />,
  treadmill_running: <Footprints className="h-3.5 w-3.5 text-green-400" />,
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

function relativeDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ACTIVITY_LABELS: Record<string, string> = {
  running: "Run",
  strength_training: "Gym",
  kiteboarding_v2: "Kite",
  wind_kite_surfing: "Kite",
  resort_snowboarding: "Snow",
  resort_skiing_snowboarding_ws: "Snow",
  hiking: "Hike",
  walking: "Walk",
  cycling: "Cycle",
  e_bike_fitness: "E-Bike",
  lap_swimming: "Swim",
  indoor_cardio: "Cardio",
  treadmill_running: "Treadmill",
};

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
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{relativeDate(a.date)}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{ACTIVITY_LABELS[a.type_key] || a.type_key}</span>
                </div>
              </div>
              <div className="text-right text-xs shrink-0">
                <div className="text-muted-foreground">
                  {a.distance_km > 0 ? `${a.distance_km.toFixed(1)} km` : formatDuration(a.duration_min)}
                </div>
                <div className="text-muted-foreground/60">
                  {a.distance_km > 0 ? formatDuration(a.duration_min) : a.calories ? `${Math.round(a.calories)} cal` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <ActivityDetailModal activityId={selectedActivityId} onClose={() => setSelectedActivityId(null)} />
      <WorkoutDetailModal workoutId={selectedWorkoutId} onClose={() => setSelectedWorkoutId(null)} />
    </>
  );
}
