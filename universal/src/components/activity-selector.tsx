import { useState, useEffect } from "react";
import { View } from "react-native";
import { Text, Card, Button } from "soma-style";
import { setActivity, useWorkoutCalories } from "../lib/api";

function Stepper({
  label, value, onChange, min, max, step, format,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; format?: (v: number) => string;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text variant="caption" className="text-text-secondary">{label}</Text>
      <View className="flex-row items-center gap-1">
        <Button label="−" variant="ghost" size="sm" disabled={value <= min} onPress={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} />
        <Text variant="body" className="w-20 text-center tabular-nums">{format ? format(value) : value}</Text>
        <Button label="+" variant="ghost" size="sm" disabled={value >= max} onPress={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))} />
      </View>
    </View>
  );
}

export interface ActivitySelectorProps {
  date: string;
  runEnabled: boolean;
  plannedRunKm: number;
  expectedSteps: number;
  selectedWorkouts: string[];
  /** A coach-planned or actual run exists for the day when > 0. */
  runDistanceKm: number;
  disabled?: boolean;
  onChanged: () => void;
}

/** "Today's Activity" — the card that drives the day's burn: run on/off (or
 *  ad-hoc planned km), expected steps, and which gym workouts count. Mirrors
 *  the web ActivitySelector, mobile-adapted with steppers + chips. */
export function ActivitySelector({
  date, runEnabled, plannedRunKm, expectedSteps, selectedWorkouts, runDistanceKm, disabled, onChanged,
}: ActivitySelectorProps) {
  const routines = useWorkoutCalories();
  const [run, setRun] = useState(runEnabled);
  const [km, setKm] = useState(plannedRunKm);
  const [steps, setSteps] = useState(expectedSteps);
  const [selected, setSelected] = useState<string[]>(selectedWorkouts);
  const [saving, setSaving] = useState(false);

  // Re-sync from the plan whenever it reloads (after a save/refetch).
  useEffect(() => { setRun(runEnabled); }, [runEnabled]);
  useEffect(() => { setKm(plannedRunKm); }, [plannedRunKm]);
  useEffect(() => { setSteps(expectedSteps); }, [expectedSteps]);
  const selKey = selectedWorkouts.join(",");
  useEffect(() => { setSelected(selectedWorkouts); }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(opts: { run_enabled?: boolean; selected_workouts?: string[]; expected_steps?: number; planned_run_km?: number | null }) {
    setSaving(true);
    const ok = await setActivity(date, opts);
    setSaving(false);
    if (ok) onChanged();
  }

  const hasRun = runDistanceKm > 0;

  return (
    <Card className={`gap-3 ${disabled ? "opacity-50" : ""}`}>
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Today&apos;s activity</Text>
        {saving ? <Text variant="micro" className="text-text-muted">saving…</Text> : null}
      </View>

      {hasRun ? (
        <View className="flex-row items-center justify-between">
          <View>
            <Text variant="caption" className="text-text-secondary">Planned run</Text>
            <Text variant="micro" className="text-text-muted tabular-nums">{runDistanceKm.toFixed(1)} km</Text>
          </View>
          <Button
            label={run ? "Counts · ON" : "OFF"}
            variant={run ? "secondary" : "ghost"}
            size="sm"
            disabled={disabled}
            onPress={() => { const next = !run; setRun(next); save({ run_enabled: next, selected_workouts: selected, expected_steps: steps }); }}
          />
        </View>
      ) : (
        <View className="gap-0.5">
          <Stepper
            label="Ad-hoc run"
            value={km}
            min={0}
            max={50}
            step={0.5}
            format={(v) => `${v.toFixed(1)} km`}
            onChange={(v) => { setKm(v); save({ planned_run_km: v > 0 ? v : null }); }}
          />
          {km > 0 ? <Text variant="micro" className="text-text-muted self-end">≈ {Math.round(km * 70)} kcal pre-allocated</Text> : null}
        </View>
      )}

      <Stepper
        label="Expected steps"
        value={steps}
        min={1000}
        max={30000}
        step={250}
        format={(v) => v.toLocaleString()}
        onChange={(v) => { setSteps(v); save({ run_enabled: run, selected_workouts: selected, expected_steps: v }); }}
      />

      {routines.length > 0 ? (
        <View className="gap-1.5">
          <Text variant="micro" className="text-text-muted">Gym workouts</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {routines.map((r) => {
              const on = selected.includes(r.hevy_title);
              return (
                <Button
                  key={r.hevy_title}
                  label={`${r.hevy_title} · ${r.avg_calories}`}
                  variant={on ? "secondary" : "ghost"}
                  size="sm"
                  disabled={disabled}
                  onPress={() => {
                    const next = on ? selected.filter((w) => w !== r.hevy_title) : [...selected, r.hevy_title];
                    setSelected(next);
                    save({ run_enabled: run, selected_workouts: next, expected_steps: steps });
                  }}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {!hasRun && routines.length === 0 ? (
        <Text variant="micro" className="text-text-muted">No gym or planned-run data for today.</Text>
      ) : null}
    </Card>
  );
}
