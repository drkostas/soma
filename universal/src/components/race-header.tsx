import { View } from "react-native";
import { Text, Badge } from "soma-style";
import type { PlanDay } from "../lib/api";

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86400000);
}

/**
 * Race context header (web parity, #424): current week X / Y and days-to-race,
 * derived from the plan schedule (the last plan day is race day). Rendered
 * inline next to the screen title.
 */
export function RaceHeader({ planDays, today }: { planDays: PlanDay[]; today: string }) {
  const days = (planDays ?? []).filter((d) => d.dayDate);
  if (days.length < 2) return null;
  const weeks = days.map((d) => d.weekNumber).filter((w) => w != null);
  const totalWeeks = weeks.length ? Math.max(...weeks) : 0;
  // current week = the week of the first plan day on/after today
  const upcoming = [...days].sort((a, b) => a.dayDate.localeCompare(b.dayDate)).find((d) => d.dayDate >= today);
  const currentWeek = upcoming?.weekNumber ?? totalWeeks;
  const raceDate = [...days].sort((a, b) => a.dayDate.localeCompare(b.dayDate))[days.length - 1].dayDate;
  const dtr = daysBetween(today, raceDate);

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {totalWeeks > 0 ? <Badge label={`Week ${currentWeek} / ${totalWeeks}`} tone="teal" /> : null}
      {dtr >= 0 ? (
        <Badge label={dtr === 0 ? "Race day" : `${dtr} days to race`} tone={dtr <= 14 ? "warm" : "neutral"} />
      ) : null}
    </View>
  );
}
