import { useState } from "react";
import { ScrollView, View, TextInput } from "react-native";
import { Text, Card, Button, Pill, PillGroup } from "soma-style";
import { submitOnboard, type OnboardBootstrap, type OnboardForm } from "../lib/api";

const STEPS = ["Profile", "Body Comp", "Exercises", "Goals", "Review"] as const;

// Hevy title patterns -> sentinel slot (mirrors web nutrition-onboarding).
const TITLE_TO_SLOT: [RegExp, string][] = [
  [/squat|leg press|hack squat|leg extension|lunge|leg curl|calf|hip abduct|hip adduct/i, "lower"],
  [/bench|chest|push.?up|dip|fly|shoulder press|overhead press|arnold|lateral raise|front raise|tricep/i, "push"],
  [/row|pull.?up|pull.?down|lat pull|bicep|curl|face pull|rear delt|reverse fly/i, "pull"],
  [/deadlift|rdl|romanian|hip thrust|good morning|back extension|hyperextension|glute/i, "hinge"],
];
function slotForExercise(name: string): string | null {
  for (const [re, slot] of TITLE_TO_SLOT) if (re.test(name)) return slot;
  return null;
}
const isMale = (sex: string) => sex.toUpperCase() === "MALE";

const SLOTS = [
  { key: "lower", label: "Lower body", hint: "Squat, Leg Press, Hack Squat", required: true },
  { key: "push", label: "Push", hint: "Bench Press, Shoulder Press", required: true },
  { key: "pull", label: "Pull", hint: "Barbell Row, Lat Pulldown", required: true },
  { key: "hinge", label: "Hinge (optional)", hint: "Romanian DL, Hip Thrust", required: false },
];

/** A labelled numeric field. */
function NumField({ label, value, onChange, hint, step, placeholder }: {
  label: string; value: number | null; onChange: (v: number | null) => void; hint?: string; step?: boolean; placeholder?: string;
}) {
  return (
    <View className="flex-1 gap-1">
      <Text variant="micro" className="text-text-muted">{label}{hint ? <Text variant="micro" className="text-warm"> {hint}</Text> : null}</Text>
      <TextInput
        keyboardType={step ? "decimal-pad" : "numeric"}
        value={value == null ? "" : String(value)}
        placeholder={placeholder}
        placeholderTextColor="#5a7a8a"
        onChangeText={(t) => onChange(t.trim() === "" ? null : Number(t))}
        className="rounded-md border border-border-subtle px-3 py-2 text-text tabular-nums"
      />
    </View>
  );
}

/** The nutrition setup wizard (5 steps), ported from the web NutritionOnboarding.
 *  Seeds from the GET /api/nutrition/onboard bootstrap and POSTs the profile. */
export function NutritionOnboarding({ bootstrap, onDone }: { bootstrap: OnboardBootstrap; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OnboardForm>({
    weight_kg: bootstrap.weight_kg,
    height_cm: bootstrap.height_cm || 175,
    age: bootstrap.age || 30,
    sex: (bootstrap.sex || "").toUpperCase() === "FEMALE" ? "FEMALE" : "MALE",
    vo2max: bootstrap.vo2max,
    estimated_bf_pct: bootstrap.estimated_bf_pct || 22,
    target_bf_pct: null,
    target_date: null,
    tdee_estimate: bootstrap.tdee,
    daily_deficit: 500,
    sentinel_exercises: [],
  });
  const update = (p: Partial<OnboardForm>) => setForm((prev) => ({ ...prev, ...p }));

  const canSubmit = form.weight_kg > 0 && form.height_cm > 0 && form.age > 0 && form.tdee_estimate > 0;
  async function handleSubmit() {
    setSaving(true);
    const ok = await submitOnboard(form);
    setSaving(false);
    if (ok) onDone();
  }

  // Derived body-comp (recomputed live on step 1 + shown on review).
  const bmi = form.weight_kg / ((form.height_cm / 100) ** 2 || 1);
  const computedBf = Math.round(
    (47.35 + 0.035 * form.age - 11.07 * (isMale(form.sex) ? 1 : 0) - 0.177 * form.height_cm +
      0.191 * form.weight_kg + 0.345 * bmi - 0.137 * (form.vo2max || 40)) * 10) / 10;
  const ffm = form.weight_kg * (1 - form.estimated_bf_pct / 100);
  const ffmi = ffm / ((form.height_cm / 100) ** 2 || 1);
  const targetCal = form.tdee_estimate - form.daily_deficit;

  function setSlot(slot: string, name: string) {
    const rest = form.sentinel_exercises.filter((s) => s.slot !== slot);
    if (name) rest.push({ slot, exercise_name: name });
    update({ sentinel_exercises: rest });
  }
  const slotValue = (slot: string) => form.sentinel_exercises.find((s) => s.slot === slot)?.exercise_name || "";

  const clampBf = (v: number) => Math.max(8, Math.min(40, Math.round(v * 2) / 2));

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <Text variant="title" className="text-center">Set up nutrition tracking</Text>

        {/* Step dots */}
        <View className="flex-row items-center justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <View key={s} className="h-2 w-8 rounded-full" style={{ backgroundColor: i <= step ? "#77c8d1" : "#152232" }} />
          ))}
        </View>
        <Text variant="caption" className="text-center text-text-muted">Step {step + 1}: {STEPS[step]}</Text>

        <Card className="gap-4">
          {step === 0 ? (
            <View className="gap-3">
              <Text variant="eyebrow">Your profile</Text>
              <Text variant="caption" className="text-text-secondary">Auto-filled from Garmin. Adjust if needed.</Text>
              <View className="flex-row gap-3">
                <NumField label="Age" hint={!bootstrap.age ? "(not in Garmin)" : undefined} value={form.age} onChange={(v) => update({ age: v ?? 0 })} />
                <View className="flex-1 gap-1">
                  <Text variant="micro" className="text-text-muted">Sex{!bootstrap.sex ? <Text variant="micro" className="text-warm"> (not in Garmin)</Text> : null}</Text>
                  <PillGroup>
                    <Pill label="Male" active={form.sex === "MALE"} onPress={() => update({ sex: "MALE" })} />
                    <Pill label="Female" active={form.sex === "FEMALE"} onPress={() => update({ sex: "FEMALE" })} />
                  </PillGroup>
                </View>
              </View>
              <View className="flex-row gap-3">
                <NumField label="Height (cm)" hint={!bootstrap.height_cm ? "(not in Garmin)" : undefined} value={form.height_cm} onChange={(v) => update({ height_cm: v ?? 0 })} />
                <NumField label="Weight (kg)" step value={form.weight_kg} onChange={(v) => update({ weight_kg: v ?? 0 })} />
              </View>
              <NumField label="VO2max (mL/kg/min)" step hint={!bootstrap.vo2max ? "(not in Garmin)" : undefined} value={form.vo2max} placeholder="e.g. 45" onChange={(v) => update({ vo2max: v })} />
            </View>
          ) : null}

          {step === 1 ? (
            <View className="gap-3">
              <Text variant="eyebrow">Body composition</Text>
              <Text variant="caption" className="text-text-secondary">Estimated from your profile + VO2max. Adjust if you know better (DEXA, calipers, visual).</Text>
              <View className="items-center gap-0.5">
                <Text variant="display" className="tabular-nums">{form.estimated_bf_pct.toFixed(1)}%</Text>
                <Text variant="micro" className="text-text-muted">Estimated body fat</Text>
              </View>
              <View className="flex-row items-center justify-center gap-3">
                <Button label="−" variant="secondary" size="sm" onPress={() => update({ estimated_bf_pct: clampBf(form.estimated_bf_pct - 0.5) })} />
                <Text variant="caption" className="text-text-muted">8% lean · 25% avg · 40% high</Text>
                <Button label="+" variant="secondary" size="sm" onPress={() => update({ estimated_bf_pct: clampBf(form.estimated_bf_pct + 0.5) })} />
              </View>
              <View className="items-center">
                <Button label={`Reset to computed (${computedBf.toFixed(1)}%)`} variant="ghost" size="sm" onPress={() => update({ estimated_bf_pct: Math.max(5, Math.min(50, computedBf)) })} />
              </View>
              <View className="flex-row justify-around">
                {([["BMI", bmi.toFixed(1)], ["Fat-free mass", `${ffm.toFixed(1)} kg`], ["FFMI", ffmi.toFixed(1)]] as const).map(([l, v]) => (
                  <View key={l} className="items-center">
                    <Text variant="body" className="font-semibold text-text tabular-nums">{v}</Text>
                    <Text variant="micro" className="text-text-muted">{l}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {step === 2 ? (
            <View className="gap-3">
              <Text variant="eyebrow">Sentinel exercises</Text>
              <Text variant="caption" className="text-text-secondary">Pick one compound lift per slot you do consistently. These track muscle-mass changes over time.</Text>
              {SLOTS.map(({ key, label, hint, required }) => {
                const matching = bootstrap.exercise_stats.filter((ex) => slotForExercise(ex.name) === key);
                return (
                  <View key={key} className="gap-1.5">
                    <Text variant="micro" className="text-text-muted">{label}{required ? <Text variant="micro" className="text-danger"> *</Text> : null}</Text>
                    {matching.length ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-h-10">
                        <View className="flex-row gap-1.5">
                          {matching.slice(0, 12).map((ex) => (
                            <Pill key={ex.name} label={`${ex.name} · ${ex.recent}/28d`} active={slotValue(key) === ex.name} onPress={() => setSlot(key, slotValue(key) === ex.name ? "" : ex.name)} />
                          ))}
                        </View>
                      </ScrollView>
                    ) : null}
                    <TextInput
                      value={slotValue(key)}
                      onChangeText={(t) => setSlot(key, t)}
                      placeholder={`e.g. ${hint.split(",")[0].trim()}`}
                      placeholderTextColor="#5a7a8a"
                      className="rounded-md border border-border-subtle px-3 py-2 text-text"
                    />
                  </View>
                );
              })}
            </View>
          ) : null}

          {step === 3 ? (
            <View className="gap-3">
              <Text variant="eyebrow">Goals</Text>
              <NumField label="Target body fat %" step value={form.target_bf_pct} placeholder="e.g. 15" onChange={(v) => update({ target_bf_pct: v })} />
              <View className="gap-1">
                <Text variant="micro" className="text-text-muted">Daily deficit (kcal)</Text>
                <PillGroup>
                  {[[300, "300 · slow"], [500, "500 · moderate"], [750, "750 · aggressive"]].map(([v, l]) => (
                    <Pill key={v as number} label={l as string} active={form.daily_deficit === v} onPress={() => update({ daily_deficit: v as number })} />
                  ))}
                </PillGroup>
              </View>
              <View className="gap-1">
                <Text variant="micro" className="text-text-muted">Target date (optional)</Text>
                <TextInput
                  value={form.target_date ?? ""}
                  onChangeText={(t) => update({ target_date: t.trim() || null })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#5a7a8a"
                  className="rounded-md border border-border-subtle px-3 py-2 text-text tabular-nums"
                />
              </View>
              <NumField label="TDEE estimate (kcal)" value={form.tdee_estimate} onChange={(v) => update({ tdee_estimate: v ?? 0 })} hint="auto from Garmin" />
            </View>
          ) : null}

          {step === 4 ? (
            <View className="gap-3">
              <Text variant="eyebrow">Review</Text>
              {([
                ["Age / Sex", `${form.age}y / ${isMale(form.sex) ? "Male" : "Female"}`],
                ["Height / Weight", `${form.height_cm} cm / ${form.weight_kg} kg`],
                ["VO2max", form.vo2max ? String(form.vo2max) : "—"],
                ["Est. BF%", `${form.estimated_bf_pct}% (FFM ${ffm.toFixed(1)} kg)`],
                ...(form.target_bf_pct ? [["Target BF%", `${form.target_bf_pct}%`]] as [string, string][] : []),
                ["TDEE", `${form.tdee_estimate} kcal`],
                ["Deficit", `${form.daily_deficit} kcal → ${targetCal} kcal/day`],
              ] as [string, string][]).map(([l, v]) => (
                <View key={l} className="flex-row justify-between border-b border-border-subtle py-1">
                  <Text variant="caption" className="text-text-muted">{l}</Text>
                  <Text variant="caption" className="text-text tabular-nums">{v}</Text>
                </View>
              ))}
              {form.sentinel_exercises.length ? (
                <View className="gap-1">
                  <Text variant="micro" className="text-text-muted">Sentinel exercises</Text>
                  {form.sentinel_exercises.map((s) => (
                    <View key={s.slot} className="flex-row gap-2">
                      <Text variant="caption" className="w-14 capitalize text-text-muted">{s.slot}</Text>
                      <Text variant="caption" className="text-text" numberOfLines={1} style={{ flexShrink: 1 }}>{s.exercise_name}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {form.sentinel_exercises.filter((s) => ["lower", "push", "pull"].includes(s.slot)).length < 3 ? (
                <Text variant="micro" className="text-warm">Tip: pick at least 3 sentinel lifts (lower + push + pull). You can add them later in settings.</Text>
              ) : null}
            </View>
          ) : null}
        </Card>

        <View className="flex-row justify-between">
          <Button label="‹ Back" variant="ghost" disabled={step === 0} onPress={() => setStep((s) => s - 1)} />
          {step < STEPS.length - 1 ? (
            <Button label="Next ›" variant="primary" onPress={() => setStep((s) => s + 1)} />
          ) : (
            <Button label={saving ? "Saving…" : "Start tracking"} variant="primary" disabled={saving || !canSubmit} onPress={handleSubmit} />
          )}
        </View>
      </View>
    </ScrollView>
  );
}
