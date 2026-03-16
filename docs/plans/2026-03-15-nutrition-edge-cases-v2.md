# Nutrition Edge Cases v2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 15 edge cases covering data protection, UX gaps, timezone issues, and missing workflows in the nutrition system.

**Architecture:** Most fixes are small targeted changes. The critical fix (#8) changes generate_today.py to preserve user-customized columns. Several UX fixes add buttons/states to existing components. Two fixes add new API endpoints.

**Tech Stack:** Next.js 16 App Router, TypeScript, Python 3.10, Neon PostgreSQL

---

### Task 1: Unlock manual_override from UI

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx`
- Modify: `web/app/api/nutrition/activity-select/route.ts`

**Step 1: Add unlock handler**

In `nutrition-dashboard.tsx`, add a handler:

```tsx
const handleUnlock = async () => {
  const res = await fetch("/api/nutrition/activity-select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, manual_override: false }),
  });
  if (res.ok) await refreshData();
};
```

**Step 2: Add unlock button on the Offset Plan badge**

Find the Offset Plan badge. Add an X button:

```tsx
{breakdown?.manualOverride && !isClosed && (
  <Badge variant="secondary" className="gap-1 text-amber-500 border-amber-500/30">
    <Lock className="h-3 w-3" />
    Offset Plan
    <button onClick={handleUnlock} className="ml-1 hover:text-foreground">
      <X className="h-3 w-3" />
    </button>
  </Badge>
)}
```

Import `X` from lucide-react.

**Step 3: Handle manual_override in activity-select API**

In `web/app/api/nutrition/activity-select/route.ts`, read `manual_override` from the body. If present, add to the UPDATE:

```ts
const manualOverride = body.manual_override;
if (manualOverride !== undefined) {
  await sql`UPDATE nutrition_day SET manual_override = ${manualOverride} WHERE date = ${date}`;
}
```

**Step 4: Commit**

```bash
git add web/components/nutrition-dashboard.tsx web/app/api/nutrition/activity-select/route.ts
git commit -m "feat(nutrition): add unlock button to clear manual_override from UI"
```

---

### Task 2: Reopen closed day

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx`
- Create: `web/app/api/nutrition/reopen-day/route.ts`

**Step 1: Create reopen API**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { date } = await req.json();
  const sql = getDb();
  await sql`UPDATE nutrition_day SET status = 'active' WHERE date = ${date}`;
  return NextResponse.json({ ok: true });
}
```

**Step 2: Add reopen button in dashboard**

After the "Closed" badge, add:

```tsx
{isClosed && (
  <button
    onClick={async () => {
      await fetch("/api/nutrition/reopen-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      await refreshData();
    }}
    className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1"
  >
    reopen
  </button>
)}
```

**Step 3: Commit**

```bash
git add web/app/api/nutrition/reopen-day/route.ts web/components/nutrition-dashboard.tsx
git commit -m "feat(nutrition): add reopen button for closed days"
```

---

### Task 3: Freeze activity toggles on past days with actuals

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx`

**Step 1: Compute shouldDisableActivities**

After `dataReady` is set, compute:

```tsx
const isPast = date < new Date().toISOString().slice(0, 10);
const hasActuals = breakdown?.runActual || (breakdown?.gymBreakdown?.some((w: any) => w.actual));
const shouldDisableActivities = breakdown?.manualOverride || (isPast && hasActuals) || isClosed;
```

**Step 2: Pass to ActivitySelector**

Change the `disabled` prop from `disabled={breakdown?.manualOverride}` to:

```tsx
disabled={shouldDisableActivities}
```

**Step 3: Update the disabled message**

In `activity-selector.tsx`, make the message dynamic. Accept an optional `disabledReason` prop:

```tsx
disabledReason={
  breakdown?.manualOverride ? "Target locked — offset plan"
  : isClosed ? "Day is closed"
  : "Activities finalized"
}
```

In activity-selector.tsx, use `disabledReason` instead of the hardcoded string.

**Step 4: Commit**

```bash
git add web/components/nutrition-dashboard.tsx web/components/activity-selector.tsx
git commit -m "fix(nutrition): freeze activity toggles on past days with actual data"
```

---

### Task 4: Auto-update weight from weight_log

**Files:**
- Modify: `web/app/api/nutrition/plan/route.ts`

**Step 1: Query latest weight from weight_log**

After the profileRows query (line 204), add:

```ts
// Use latest weight from weight_log (more current than profile)
let latestWeight = weightKg;
try {
  const weightRows = await sql`
    SELECT weight_grams / 1000.0 AS weight_kg FROM weight_log
    WHERE weight_grams IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `;
  if (weightRows[0]?.weight_kg) {
    latestWeight = Number(weightRows[0].weight_kg);
  }
} catch {}
```

**Step 2: Use latestWeight for macro computation**

Replace all instances of `weightKg` used in macro computation with `latestWeight`:
- `calPerStep = 0.0005 * latestWeight`
- `dayTargets.protein = Math.round(latestWeight * 2.2)`
- `dayTargets.fat = Math.round(latestWeight * 0.8)`
- `baseRunCal = Math.round(runDistanceKm * 1.0 * latestWeight)`

Keep `weightKg` from profile as fallback only.

**Step 3: Commit**

```bash
git add web/app/api/nutrition/plan/route.ts
git commit -m "fix(nutrition): use latest weight_log weight for macro targets"
```

---

### Task 5: Fix 7-day trend to show computed targets

**Files:**
- Modify: `web/app/api/nutrition/plan/route.ts`

**Context:** The trend query returns stored `target_calories` from nutrition_day, but the page computes different targets dynamically (BMR fix, profile deficit, etc.). The trend should show what the page would show for each day.

**Step 1: For the CURRENT day, use the computed target**

After the trend query, patch the current day's target:

```ts
const trend7d = {
  days: trendRows.map((r: Record<string, unknown>) => {
    const isCurrentDay = r.date === date;
    const displayTarget = isCurrentDay && breakdown
      ? (breakdown as any).targetIntake
      : Number(r.target_calories) || 0;
    return {
      date: r.date,
      target: displayTarget,
      actual: Number(r.actual_calories) || 0,
      closed: r.status === "closed",
      delta: r.status === "closed"
        ? (Number(r.actual_calories) || 0) - displayTarget
        : null,
    };
  }),
  // ... rest unchanged
};
```

Note: We can't recompute ALL past days' targets in the trend (that would require N separate BMR/step queries). For past days, the stored target is good enough — they were generated with the same logic. The main mismatch is the current day.

**Step 2: Commit**

```bash
git add web/app/api/nutrition/plan/route.ts
git commit -m "fix(nutrition): 7-day trend uses computed target for current day"
```

---

### Task 6: Manual target shows context

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx`

**Step 1: Add deficit context to manual target display**

Change the manual target line from:

```tsx
<>Manual target: {breakdown.targetIntake} kcal</>
```

To:

```tsx
<>
  Manual target: {breakdown.targetIntake} kcal
  {breakdown.deficit > 0 && (
    <span className="text-muted-foreground/60"> (deficit: {breakdown.deficit})</span>
  )}
</>
```

**Step 2: Commit**

```bash
git add web/components/nutrition-dashboard.tsx
git commit -m "feat(nutrition): show deficit context on manual target display"
```

---

### Task 7: Close day respects manual_override

**Files:**
- Modify: `web/app/api/nutrition/close-day/route.ts`

**Step 1: Read the file and find where actual_calories is set**

When closing a manual_override day, `actual_calories` should be the sum of meal_log calories (what was actually eaten), not any Garmin-derived value. Check what close-day currently does and ensure it writes `actual_calories = SUM(meal_log.calories)` for that date.

**Step 2: Preserve manual_override and target on close**

Ensure the close-day API does NOT overwrite `target_calories` or `manual_override`. It should only set `status = 'closed'` and `actual_calories/protein/carbs/fat/fiber` from meal totals.

**Step 3: Commit**

```bash
git add web/app/api/nutrition/close-day/route.ts
git commit -m "fix(nutrition): close day preserves manual_override and sets actuals from meals"
```

---

### Task 8: generate_today.py preserves user customizations (CRITICAL)

**Files:**
- Modify: `sync/src/nutrition_engine/generate_today.py:353-380`

**Context:** The ON CONFLICT DO UPDATE overwrites ALL columns including `skipped_slots`, `run_enabled`, `selected_workouts`, `expected_steps` which the user may have customized via the UI. The cron runs ~12x/day, wiping these each time.

**Step 1: Exclude user-customizable columns from the UPDATE**

The upsert should NOT update these columns if the row already exists:
- `skipped_slots`
- `run_enabled`
- `selected_workouts`
- `expected_steps`

These columns are not in the INSERT/UPDATE currently (they're added by the activity-select API), so actually check: does the ON CONFLICT DO UPDATE touch them?

Looking at the SQL: the INSERT lists `date, plan, target_calories, target_protein, target_carbs, target_fat, target_fiber, tdee_used, deficit_used, adjustment_reason, sleep_quality_score, training_day_type, is_refeed, exercise_calories, step_calories, planned_workouts, step_goal`.

It does NOT include `skipped_slots`, `run_enabled`, `selected_workouts`, `expected_steps` in the INSERT or UPDATE. So these should be safe.

Wait — but ON CONFLICT DO UPDATE on `(date)` only updates the columns explicitly listed. Columns NOT in the SET clause are preserved. So `skipped_slots`, `run_enabled`, etc. are already preserved!

Let me verify: the UPDATE SET lists: `plan, target_calories, target_protein, target_carbs, target_fat, target_fiber, tdee_used, deficit_used, adjustment_reason, sleep_quality_score, training_day_type, is_refeed, exercise_calories, step_calories, planned_workouts, step_goal`.

**These are the computed plan columns, NOT the user-customization columns.** So the user customizations (skipped_slots, run_enabled, selected_workouts, expected_steps) are actually already preserved!

**However:** `target_calories, target_protein, target_carbs, target_fat` DO get overwritten. The plan API then recomputes from components, so the stored targets being overwritten shouldn't matter for the UI... BUT the 7-day trend reads stored `target_calories`, which gets reset to generate_today's computed value.

**The real fix needed:** Don't overwrite `target_calories` etc. if the user has a manual_override. This is already handled by Task 1 of the previous plan (skip if manual_override). For non-manual days, the generate_today recalculation is correct behavior — it refreshes the targets based on latest sleep/weight data.

**Step 2: Verify no action needed**

Actually on re-analysis, the user-customizable columns are already safe. The previous fix (skip manual_override days) handles the critical case. This task reduces to verification only.

But there IS still a subtle issue: generate_today.py runs for today and overwrites `target_calories` with a freshly computed value. If the plan API also computes dynamically, they might disagree. The plan API's value wins (it's what the user sees), but the stored value feeds the 7-day trend.

**Step 3: Make generate_today preserve user columns explicitly**

To be defensive, add a check: if the row already exists (INSERT succeeds), fine. If ON CONFLICT fires, preserve user columns by not updating them. The current SQL already does this correctly. Add a comment for clarity:

```python
# NOTE: ON CONFLICT preserves user-set columns (skipped_slots, run_enabled,
# selected_workouts, expected_steps, manual_override) because they are NOT
# in the UPDATE SET clause. Only plan-computed columns are refreshed.
```

**Step 4: Commit**

```bash
git add sync/src/nutrition_engine/generate_today.py
git commit -m "docs(nutrition): clarify generate_today preserves user-customized columns"
```

---

### Task 9: Create nutrition_day row for future dates on navigate

**Files:**
- Modify: `web/app/nutrition/page.tsx`

**Context:** `meal_log` has FK to `nutrition_day(date)`. If you navigate to a date with no nutrition_day row, you can't log meals. The page should auto-create a minimal row.

**Step 1: Auto-create nutrition_day row in the page server component**

In `getNutritionDay`, if no row exists, create a minimal one:

```ts
async function getNutritionDay(date: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM nutrition_day WHERE date = ${date}
  `;
  if (rows[0]) return rows[0];

  // Auto-create minimal row so meals can be logged
  try {
    await sql`
      INSERT INTO nutrition_day (date, status)
      VALUES (${date}, 'active')
      ON CONFLICT (date) DO NOTHING
    `;
  } catch {}
  return null; // plan data still null — plan API will handle defaults
}
```

**Step 2: Commit**

```bash
git add web/app/nutrition/page.tsx
git commit -m "fix(nutrition): auto-create nutrition_day row for any navigated date"
```

---

### Task 10: Fix timezone for "today" detection

**Files:**
- Modify: `web/app/nutrition/page.tsx`
- Modify: `web/app/api/nutrition/plan/route.ts`

**Step 1: Use client timezone for "today" default**

In `page.tsx` (line 211), the current code:
```ts
const today = params.date || new Date().toISOString().slice(0, 10);
```

This uses UTC. Change to use a timezone-aware date. Since this is SSR and we can't access the client timezone, use a fixed timezone (user is in EST/EDT):

```ts
const today = params.date || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
```

`en-CA` locale formats as `YYYY-MM-DD`.

**Step 2: Same fix in plan API**

In `route.ts` (line 79):
```ts
new Date().toISOString().slice(0, 10)
```

Change to:
```ts
new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })
```

**Step 3: Also fix the isPast check in plan API**

Find: `const isPast = date < new Date().toISOString().slice(0, 10);`

Change to: `const isPast = date < new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });`

**Step 4: Commit**

```bash
git add web/app/nutrition/page.tsx web/app/api/nutrition/plan/route.ts
git commit -m "fix(nutrition): use America/New_York timezone for today detection"
```

---

### Task 11: Quick custom food entry

**Files:**
- Modify: `web/components/meal-card.tsx`

**Step 1: Add "Quick Add" button next to "Add meal"**

In the meal card, alongside the compose/preset flow, add a minimal form:

```tsx
<Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowQuickAdd(true)}>
  Quick add
</Button>
```

**Step 2: Quick add form**

When `showQuickAdd` is true, render a small form with fields: name, calories, protein, carbs, fat. Submit POSTs to `/api/nutrition/log-meal` with `source: "quick_add"` and items as a single-item array with the custom values.

```tsx
{showQuickAdd && (
  <div className="space-y-2 p-3 border rounded-lg">
    <input placeholder="Name (e.g., Restaurant burger)" className="w-full text-sm bg-background border rounded px-2 py-1" value={quickName} onChange={e => setQuickName(e.target.value)} />
    <div className="grid grid-cols-4 gap-2">
      <input placeholder="kcal" type="number" className="text-sm bg-background border rounded px-2 py-1" value={quickCal} onChange={e => setQuickCal(e.target.value)} />
      <input placeholder="P" type="number" className="text-sm bg-background border rounded px-2 py-1" value={quickP} onChange={e => setQuickP(e.target.value)} />
      <input placeholder="C" type="number" className="text-sm bg-background border rounded px-2 py-1" value={quickC} onChange={e => setQuickC(e.target.value)} />
      <input placeholder="F" type="number" className="text-sm bg-background border rounded px-2 py-1" value={quickF} onChange={e => setQuickF(e.target.value)} />
    </div>
    <div className="flex gap-2">
      <Button size="sm" className="text-xs" onClick={handleQuickAdd}>Add</Button>
      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowQuickAdd(false)}>Cancel</Button>
    </div>
  </div>
)}
```

**Step 3: handleQuickAdd**

```tsx
const handleQuickAdd = async () => {
  const items = [{
    ingredient_id: `custom_${Date.now()}`,
    grams: 0,
    calories: Number(quickCal) || 0,
    protein: Number(quickP) || 0,
    carbs: Number(quickC) || 0,
    fat: Number(quickF) || 0,
    fiber: 0,
    name: quickName || "Custom food",
  }];
  await fetch("/api/nutrition/log-meal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date, meal_slot: slot, source: "quick_add",
      items, calories: Number(quickCal) || 0,
      protein: Number(quickP) || 0, carbs: Number(quickC) || 0,
      fat: Number(quickF) || 0, fiber: 0,
    }),
  });
  setShowQuickAdd(false);
  setQuickName(""); setQuickCal(""); setQuickP(""); setQuickC(""); setQuickF("");
  onMealLogged();
};
```

**Step 4: Commit**

```bash
git add web/components/meal-card.tsx
git commit -m "feat(nutrition): quick add custom food with manual macro entry"
```

---

### Task 12: Debounce meal logging to prevent duplicates

**Files:**
- Modify: `web/components/meal-card.tsx`

**Step 1: Add debounce state**

The `logging` state already exists and is set to true during the POST. Check that ALL logging paths (preset, compose, quick add) set `logging = true` before the fetch and disable the buttons while `logging` is true.

**Step 2: Disable buttons while logging**

Find all "Add meal", "Log" buttons and ensure they have `disabled={logging}`. Also add `disabled={logging}` to preset picker items and the quick add button.

**Step 3: Commit**

```bash
git add web/components/meal-card.tsx
git commit -m "fix(nutrition): disable meal log buttons while request is in flight"
```

---

### Task 13: Show "During Workout" slot for long gym sessions

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx`

**Step 1: Expand the condition for showing the slot**

Find (around line 231):
```ts
const showDuringWorkout = trainingDurationMin > 60 || trainingDistanceKm > 10;
```

Change to also consider gym workouts. If selected workouts exist and the training day includes gym:
```ts
const showDuringWorkout = trainingDurationMin > 60 || trainingDistanceKm > 10
  || (training?.gym_workout && trainingDistanceKm > 0); // run + gym day = long session
```

Actually simpler: just always show it if there's a run planned. Users can ignore it if not needed:
```ts
const showDuringWorkout = trainingDistanceKm > 10 || trainingDurationMin > 60;
```

Keep as-is — this is fine. The 10km/60min threshold is reasonable. Only edge case is if someone does a 2hr gym-only session, but that's rare and they can log intra-workout food to the pre-sleep slot instead.

**Step 2: No change needed — skip this task**

---

### Task 14: Copy Yesterday shows budget context

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx`

**Step 1: After copying, the budget will auto-update**

The "Copy Yesterday" button calls refreshData() after copying. The plan API computes the current day's target independently, so the budget shown is correct for today — it just happens that yesterday's meals might not fit today's budget.

**Step 2: Show a warning if copied meals exceed today's target**

After the copy, check if `consumedCal > targetCal`. This already shows as negative remaining. No additional change needed — the existing UI already communicates this clearly through the negative remaining and red progress bar.

**Step 3: No change needed — skip this task**

---

### Task 15: Negative remaining shows "over by X"

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx`

**Step 1: Change the remaining display for negative values**

Find the remaining calories display (around line 322):
```tsx
<div className={`text-4xl font-bold tabular-nums ${remainingCal < 0 ? "text-muted-foreground" : ""}`}>
  {Math.round(remainingCal)}
</div>
<div className="text-xs text-muted-foreground">calories remaining</div>
```

Change to:
```tsx
<div className={`text-4xl font-bold tabular-nums ${remainingCal < 0 ? "text-rose-500" : ""}`}>
  {remainingCal < 0 ? `+${Math.abs(Math.round(remainingCal))}` : Math.round(remainingCal)}
</div>
<div className="text-xs text-muted-foreground">
  {remainingCal < 0 ? "calories over budget" : "calories remaining"}
</div>
```

**Step 2: Commit**

```bash
git add web/components/nutrition-dashboard.tsx
git commit -m "feat(nutrition): show 'over budget' in red when calories exceeded"
```

---

## Summary

| # | Fix | Effort | File(s) |
|---|-----|--------|---------|
| 1 | Unlock manual_override UI | Small | dashboard.tsx, activity-select API |
| 2 | Reopen closed day | Small | dashboard.tsx, new reopen-day API |
| 3 | Freeze toggles on past days | Small | dashboard.tsx, activity-selector.tsx |
| 4 | Weight from weight_log | Small | plan/route.ts |
| 5 | Trend shows computed target | Small | plan/route.ts |
| 6 | Manual target shows deficit context | Tiny | dashboard.tsx |
| 7 | Close day respects manual_override | Small | close-day API |
| 8 | generate_today preserves user columns | Verify only | generate_today.py (comment) |
| 9 | Auto-create nutrition_day for any date | Small | page.tsx |
| 10 | Timezone fix (EST) | Small | page.tsx, plan/route.ts |
| 11 | Quick add custom food | Medium | meal-card.tsx |
| 12 | Debounce meal logging | Small | meal-card.tsx |
| 13 | During Workout slot for gym | Skip | — |
| 14 | Copy Yesterday context | Skip | — |
| 15 | "Over budget" display | Small | dashboard.tsx |

Tasks 13 and 14 are skipped — current behavior is acceptable.
Effective tasks: 13 (after skips).
