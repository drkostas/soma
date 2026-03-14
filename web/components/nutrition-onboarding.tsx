"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, Loader2 } from "lucide-react";

interface BootstrapData {
  tdee: number;
  weight_kg: number;
  height_cm: number | null;
  age: number | null;
  sex: string | null;
  vo2max: number | null;
  estimated_bf_pct: number | null;
  recent_exercises: string[];
}

interface ProfileFormData {
  weight_kg: number;
  height_cm: number;
  age: number;
  sex: string;
  vo2max: number | null;
  estimated_bf_pct: number;
  target_bf_pct: number | null;
  target_date: string | null;
  tdee_estimate: number;
  daily_deficit: number;
  sentinel_exercises: { slot: string; exercise_name: string }[];
}

const STEPS = ["Profile", "Body Comp", "Exercises", "Goals", "Review"] as const;

function normalizeSex(sex: string | null): string {
  if (!sex) return "MALE";
  return sex.toUpperCase() === "MALE" ? "MALE" : "FEMALE";
}

function isMaleSex(sex: string): boolean {
  return sex.toUpperCase() === "MALE";
}

export function NutritionOnboarding({ bootstrap }: { bootstrap: BootstrapData }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<ProfileFormData>({
    weight_kg: bootstrap.weight_kg,
    height_cm: bootstrap.height_cm || 175,
    age: bootstrap.age || 30,
    sex: normalizeSex(bootstrap.sex),
    vo2max: bootstrap.vo2max,
    estimated_bf_pct: bootstrap.estimated_bf_pct || 22,
    target_bf_pct: null,
    target_date: null,
    tdee_estimate: bootstrap.tdee,
    daily_deficit: 500,
    sentinel_exercises: [],
  });

  const update = (partial: Partial<ProfileFormData>) =>
    setForm((prev) => ({ ...prev, ...partial }));

  const canNext = step < STEPS.length - 1;
  const canBack = step > 0;

  async function handleSubmit() {
    setSaving(true);
    try {
      const res = await fetch("/api/nutrition/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    form.weight_kg > 0 &&
    form.height_cm > 0 &&
    form.age > 0 &&
    form.tdee_estimate > 0;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-center">Set Up Nutrition Tracking</h2>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div
              className={`h-2 w-8 rounded-full transition-colors ${
                i <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          </div>
        ))}
      </div>
      <div className="text-center text-sm text-muted-foreground">
        Step {step + 1}: {STEPS[step]}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          {step === 0 && (
            <StepProfile form={form} update={update} bootstrap={bootstrap} />
          )}
          {step === 1 && (
            <StepBodyComp form={form} update={update} bootstrap={bootstrap} />
          )}
          {step === 2 && (
            <StepExercises
              form={form}
              update={update}
              recentExercises={bootstrap.recent_exercises}
            />
          )}
          {step === 3 && (
            <StepGoals form={form} update={update} />
          )}
          {step === 4 && (
            <StepReview form={form} />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => s - 1)}
          disabled={!canBack}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        {canNext ? (
          <Button onClick={() => setStep((s) => s + 1)}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={saving || !canSubmit}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {saving ? "Saving..." : "Start Tracking"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Step Components (inline for now, can extract later) ──

function StepProfile({
  form,
  update,
  bootstrap,
}: {
  form: ProfileFormData;
  update: (p: Partial<ProfileFormData>) => void;
  bootstrap: BootstrapData;
}) {
  const missingAge = !bootstrap.age || bootstrap.age === 0;
  const missingSex = !bootstrap.sex;
  const missingHeight = !bootstrap.height_cm || bootstrap.height_cm === 0;

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Your Profile</h3>
      <p className="text-sm text-muted-foreground">
        Auto-filled from Garmin. Adjust if needed.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            Age{missingAge && <span className="text-amber-500/80 ml-1">(not found in Garmin)</span>}
          </span>
          <input
            type="number"
            value={form.age}
            onChange={(e) => update({ age: Number(e.target.value) })}
            className="w-full rounded-md border px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            Sex{missingSex && <span className="text-amber-500/80 ml-1">(not found in Garmin)</span>}
          </span>
          <select
            value={form.sex}
            onChange={(e) => update({ sex: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm bg-background"
          >
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            Height (cm){missingHeight && <span className="text-amber-500/80 ml-1">(not found in Garmin)</span>}
          </span>
          <input
            type="number"
            value={form.height_cm}
            onChange={(e) => update({ height_cm: Number(e.target.value) })}
            className="w-full rounded-md border px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Weight (kg)</span>
          <input
            type="number"
            step="0.1"
            value={form.weight_kg}
            onChange={(e) => update({ weight_kg: Number(e.target.value) })}
            className="w-full rounded-md border px-3 py-2 text-sm bg-background"
          />
        </label>
      </div>
      {form.vo2max && (
        <div className="text-xs text-muted-foreground">
          VO2max from Garmin: <span className="font-medium text-foreground">{form.vo2max}</span> mL/kg/min
        </div>
      )}
    </div>
  );
}

function StepBodyComp({
  form,
  update,
}: {
  form: ProfileFormData;
  update: (p: Partial<ProfileFormData>) => void;
  bootstrap: BootstrapData;
}) {
  // Recompute BF% when inputs change (NHANES linear equation)
  const isMale = isMaleSex(form.sex) ? 1 : 0;
  const bmi = form.weight_kg / ((form.height_cm / 100) ** 2);
  const computed = Math.round(
    (47.35 + 0.035 * form.age - 11.07 * isMale - 0.177 * form.height_cm +
      0.191 * form.weight_kg + 0.345 * bmi - 0.137 * (form.vo2max || 40)) * 10
  ) / 10;

  const ffm = form.weight_kg * (1 - form.estimated_bf_pct / 100);
  const ffmi = ffm / ((form.height_cm / 100) ** 2);

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Body Composition</h3>
      <p className="text-sm text-muted-foreground">
        Estimated from your profile + VO2max. Adjust with the slider if you know better
        (from DEXA, calipers, or visual estimate).
      </p>

      <div className="text-center space-y-1">
        <div className="text-4xl font-bold tabular-nums">
          {form.estimated_bf_pct.toFixed(1)}%
        </div>
        <div className="text-xs text-muted-foreground">Estimated body fat</div>
      </div>

      <input
        type="range"
        min={8}
        max={40}
        step={0.5}
        value={form.estimated_bf_pct}
        onChange={(e) => update({ estimated_bf_pct: Number(e.target.value) })}
        className="w-full accent-primary"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>8% (lean)</span>
        <span>25% (average)</span>
        <span>40% (high)</span>
      </div>

      <div className="grid grid-cols-5 text-[10px] text-muted-foreground/70 text-center">
        <span>8-12%<br/>Visible abs</span>
        <span>13-17%<br/>Athletic</span>
        <span>18-22%<br/>Fit</span>
        <span>23-27%<br/>Average</span>
        <span>28%+<br/>Above avg</span>
      </div>

      <div className="flex justify-center">
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => update({ estimated_bf_pct: Math.max(5, Math.min(50, computed)) })}
        >
          Reset to computed ({computed.toFixed(1)}%)
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
        <div>
          <div className="text-sm font-medium text-foreground">{bmi.toFixed(1)}</div>
          BMI
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">{ffm.toFixed(1)} kg</div>
          Fat-free mass
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">{ffmi.toFixed(1)}</div>
          FFMI
        </div>
      </div>
    </div>
  );
}

function StepExercises({
  form,
  update,
  recentExercises,
}: {
  form: ProfileFormData;
  update: (p: Partial<ProfileFormData>) => void;
  recentExercises: string[];
}) {
  const slots = [
    { key: "lower", label: "Lower Body", hint: "Squat, Leg Press, Hack Squat", required: true },
    { key: "push", label: "Push", hint: "Bench Press, Dumbbell Press", required: true },
    { key: "pull", label: "Pull", hint: "Barbell Row, Lat Pulldown", required: true },
    { key: "hinge", label: "Hinge (optional)", hint: "Romanian DL, Deadlift", required: false },
  ];

  const selectedNames = form.sentinel_exercises.map((s) => s.exercise_name);

  function setSlot(slot: string, exerciseName: string) {
    const filtered = form.sentinel_exercises.filter((s) => s.slot !== slot);
    if (exerciseName) {
      filtered.push({ slot, exercise_name: exerciseName });
    }
    update({ sentinel_exercises: filtered });
  }

  function getSlotValue(slot: string) {
    return form.sentinel_exercises.find((s) => s.slot === slot)?.exercise_name || "";
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Sentinel Exercises</h3>
      <p className="text-sm text-muted-foreground">
        Pick one compound exercise per slot that you do consistently every week.
        These track your muscle mass changes over time.
      </p>

      {slots.map(({ key, label, hint, required }) => (
        <label key={key} className="space-y-1">
          <span className="text-xs text-muted-foreground">
            {label} {required && <span className="text-red-400">*</span>}
          </span>
          {recentExercises.length > 0 ? (
            <select
              value={getSlotValue(key)}
              onChange={(e) => setSlot(key, e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              <option value="">Select exercise...</option>
              {recentExercises.map((ex) => (
                <option
                  key={ex}
                  value={ex}
                  disabled={selectedNames.includes(ex) && getSlotValue(key) !== ex}
                >
                  {ex}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={getSlotValue(key)}
              onChange={(e) => setSlot(key, e.target.value)}
              placeholder={`e.g., ${hint.split(",")[0].trim()}`}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            />
          )}
          <span className="text-[10px] text-muted-foreground/70">{hint}</span>
        </label>
      ))}
    </div>
  );
}

function StepGoals({
  form,
  update,
}: {
  form: ProfileFormData;
  update: (p: Partial<ProfileFormData>) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Goals</h3>

      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">Target body fat %</span>
        <input
          type="number"
          step="0.5"
          value={form.target_bf_pct || ""}
          placeholder="e.g., 15"
          onChange={(e) => update({ target_bf_pct: e.target.value ? Number(e.target.value) : null })}
          className="w-full rounded-md border px-3 py-2 text-sm bg-background"
        />
      </label>

      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">Daily deficit (kcal)</span>
        <select
          value={form.daily_deficit}
          onChange={(e) => update({ daily_deficit: Number(e.target.value) })}
          className="w-full rounded-md border px-3 py-2 text-sm bg-background"
        >
          <option value={300}>300 kcal (slow, muscle-sparing)</option>
          <option value={500}>500 kcal (moderate, ~0.5 kg/week)</option>
          <option value={750}>750 kcal (aggressive, ~0.7 kg/week)</option>
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">Target date (optional)</span>
        <input
          type="date"
          value={form.target_date || ""}
          onChange={(e) => update({ target_date: e.target.value || null })}
          className="w-full rounded-md border px-3 py-2 text-sm bg-background"
        />
      </label>

      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">TDEE estimate (kcal)</span>
        <input
          type="number"
          value={form.tdee_estimate}
          onChange={(e) => update({ tdee_estimate: Number(e.target.value) })}
          className="w-full rounded-md border px-3 py-2 text-sm bg-background"
        />
        <span className="text-[10px] text-muted-foreground/70">Auto-computed from Garmin BMR + activity. Will self-calibrate over time.</span>
      </label>
    </div>
  );
}

function StepReview({ form }: { form: ProfileFormData }) {
  const ffm = form.weight_kg * (1 - form.estimated_bf_pct / 100);
  const targetCal = form.tdee_estimate - form.daily_deficit;
  const requiredSentinels = form.sentinel_exercises.filter(
    (s) => ["lower", "push", "pull"].includes(s.slot)
  );

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Review</h3>

      <div className="grid grid-cols-2 gap-y-2 text-sm">
        <div className="text-muted-foreground">Age / Sex</div>
        <div>{form.age}y / {isMaleSex(form.sex) ? "Male" : "Female"}</div>

        <div className="text-muted-foreground">Height / Weight</div>
        <div>{form.height_cm} cm / {form.weight_kg} kg</div>

        <div className="text-muted-foreground">VO2max</div>
        <div>{form.vo2max || "\u2014"}</div>

        <div className="text-muted-foreground">Estimated BF%</div>
        <div>{form.estimated_bf_pct}% (FFM: {ffm.toFixed(1)} kg)</div>

        {form.target_bf_pct && (
          <>
            <div className="text-muted-foreground">Target BF%</div>
            <div>{form.target_bf_pct}%</div>
          </>
        )}

        <div className="text-muted-foreground">TDEE</div>
        <div>{form.tdee_estimate} kcal</div>

        <div className="text-muted-foreground">Deficit</div>
        <div>{form.daily_deficit} kcal &rarr; {targetCal} kcal/day</div>
      </div>

      {form.sentinel_exercises.length > 0 && (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">Sentinel exercises:</div>
          {form.sentinel_exercises.map((s) => (
            <div key={s.slot} className="text-sm flex gap-2">
              <span className="text-muted-foreground capitalize w-12">{s.slot}</span>
              <span>{s.exercise_name}</span>
            </div>
          ))}
        </div>
      )}

      {requiredSentinels.length < 3 && (
        <div className="text-xs text-amber-500">
          Tip: Pick at least 3 sentinel exercises (lower + push + pull) for body composition tracking.
          You can skip this and add them later in settings.
        </div>
      )}
    </div>
  );
}
