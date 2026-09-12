import { useState } from "react";
import { View, Pressable, TextInput, ScrollView } from "react-native";
import { Text, Modal, Button } from "soma-style";
import type { PlanDay, WorkoutStep } from "../lib/api";

const STEP_TYPES = ["warmup", "run", "interval", "recovery", "cooldown"] as const;
const DURATION_TYPES = [
  { key: "distance", label: "km" },
  { key: "time", label: "min" },
] as const;

function clone(steps: WorkoutStep[] | null | undefined): WorkoutStep[] {
  return (steps ?? []).map((s) => ({ ...s }));
}

/**
 * Web's per-step editor (workout-step-editor.tsx + step-detail-drawer.tsx) as a sheet: edit a
 * planned day's steps — type, distance/time, description — add or remove steps, then Save
 * through the same endpoint web uses (`/api/training/delta/save`, `updatedWorkouts[].workoutSteps`).
 * Only the user's own plan is touched; nothing is pushed to Garmin here (the plan-push cron
 * does that on its own schedule, as on web) (soma#794).
 */
export function StepEditorSheet({ day, onClose, onSave }: { day: PlanDay | null; onClose: () => void; onSave: (dayId: number, steps: WorkoutStep[]) => Promise<boolean> }) {
  const [steps, setSteps] = useState<WorkoutStep[]>(() => clone(day?.workoutSteps));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<"idle" | "saved" | "error">("idle");
  // A different day resets the editor: adjusted during render, not in an effect.
  const [editing, setEditing] = useState(day);
  if (editing !== day) { setEditing(day); setSteps(clone(day?.workoutSteps)); setResult("idle"); }
  if (!day) return null;

  const update = (i: number, patch: Partial<WorkoutStep>) => setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => setSteps((prev) => prev.filter((_, k) => k !== i));
  const add = () => setSteps((prev) => [...prev, { step_type: "run", duration_type: "distance", duration_value: 1, description: "" }]);
  const dirty = JSON.stringify(steps) !== JSON.stringify(clone(day.workoutSteps));

  return (
    <Modal visible={!!day} onClose={onClose} title={`Edit steps · ${day.runTitle || day.runType}`}>
      <ScrollView className="max-h-[70vh]" contentContainerClassName="gap-3" testID="step-editor">
        <Text variant="micro" className="text-text-muted">{day.dayDate} · week {day.weekNumber}{day.targetDistanceKm != null ? ` · ${day.targetDistanceKm} km planned` : ""}</Text>
        {steps.map((s, i) => (
          <View key={i} className="gap-2 rounded-lg border border-border-subtle p-2.5" testID={`step-editor-row-${i}`}>
            <View className="flex-row flex-wrap gap-1.5">
              {STEP_TYPES.map((t) => (
                <Pressable key={t} onPress={() => update(i, { step_type: t })} className={`rounded-full px-2.5 py-1 ${s.step_type === t ? "bg-teal" : "bg-surface-subtle"}`} accessibilityRole="button">
                  <Text variant="micro" className={s.step_type === t ? "text-base" : "text-text-secondary"}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={s.duration_value != null ? String(s.duration_value) : ""}
                onChangeText={(v) => update(i, { duration_value: v.trim() === "" ? null : Number(v.replace(",", ".")) })}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#5a7a8a"
                className="w-20 rounded-md border border-border-subtle px-2 py-1.5 text-text"
                testID={`step-editor-value-${i}`}
              />
              {DURATION_TYPES.map((d) => (
                <Pressable key={d.key} onPress={() => update(i, { duration_type: d.key })} className={`rounded-full px-2.5 py-1 ${(s.duration_type ?? "distance") === d.key ? "bg-teal" : "bg-surface-subtle"}`} accessibilityRole="button">
                  <Text variant="micro" className={(s.duration_type ?? "distance") === d.key ? "text-base" : "text-text-secondary"}>{d.label}</Text>
                </Pressable>
              ))}
              <View className="flex-1" />
              <Pressable onPress={() => remove(i)} hitSlop={6} accessibilityLabel="Remove step" testID={`step-editor-remove-${i}`}>
                <Text variant="micro" className="text-danger">remove</Text>
              </Pressable>
            </View>
            <TextInput
              value={s.description ?? ""}
              onChangeText={(v) => update(i, { description: v })}
              placeholder="description (optional)"
              placeholderTextColor="#5a7a8a"
              className="rounded-md border border-border-subtle px-2 py-1.5 text-text"
            />
          </View>
        ))}
        <Pressable onPress={add} className="self-start rounded-full border border-border-subtle px-3 py-1" accessibilityRole="button" testID="step-editor-add">
          <Text variant="micro" className="text-teal">+ Add step</Text>
        </Pressable>
        <View className="flex-row items-center justify-end gap-2">
          {result === "saved" ? <Text variant="micro" className="text-success">Saved</Text> : result === "error" ? <Text variant="micro" className="text-danger">Save failed</Text> : null}
          <Button variant="ghost" size="sm" label="Cancel" onPress={onClose} />
          <Button variant="secondary" size="sm" label={saving ? "Saving…" : "Save"} disabled={!dirty || saving} onPress={async () => {
            setSaving(true);
            const ok = await onSave(day.id, steps);
            setSaving(false); setResult(ok ? "saved" : "error");
            if (ok) setTimeout(onClose, 800);
          }} />
        </View>
      </ScrollView>
    </Modal>
  );
}
