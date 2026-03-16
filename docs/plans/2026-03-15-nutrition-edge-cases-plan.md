# Nutrition Edge Cases — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 edge cases in the nutrition system: protect manual_override, fix equation display, add locked-day indicator, scale macros on extreme deficit, fix deficit source, use actual steps for past days, fix cancel-deletes-meal bug, and hide macro flash on SSR.

**Architecture:** Most fixes are small targeted changes to `plan/route.ts` (API), `nutrition-dashboard.tsx` (UI), `meal-card.tsx` (cancel bug), and `generate_today.py` (manual_override protection + deficit source). No new tables or major refactors.

**Tech Stack:** Next.js 16 App Router, TypeScript, Python 3.10, Neon PostgreSQL

---

### Task 1: Protect manual_override from generate_today.py

**Files:**
- Modify: `sync/src/nutrition_engine/generate_today.py:121-130`

**Step 1: Add manual_override check at start of generate_today()**

After line 132 (`cur = conn.cursor()`), before the profile query, add:

```python
# Skip if today already has a manual_override plan
cur.execute(
    "SELECT manual_override FROM nutrition_day WHERE date = %s",
    (today,),
)
existing = cur.fetchone()
if existing and existing[0]:
    logger.info("Skipping %s — manual_override is set", today)
    cur.close()
    return
```

**Step 2: Commit**

```bash
git add sync/src/nutrition_engine/generate_today.py
git commit -m "fix(nutrition): skip generate_today for manual_override days"
```

---

### Task 2: Fix BMR query in generate_today.py

**Files:**
- Modify: `sync/src/nutrition_engine/generate_today.py:172-187`

**Context:** Currently queries `ORDER BY date DESC LIMIT 1` which can pick up today's partial BMR. Should query yesterday's full-day BMR like the plan API does.

**Step 1: Fix the BMR query**

Replace lines 174-178:
```python
cur.execute(
    "SELECT bmr_kilocalories FROM daily_health_summary "
    "WHERE bmr_kilocalories IS NOT NULL "
    "ORDER BY date DESC LIMIT 1"
)
```

With:
```python
cur.execute(
    "SELECT bmr_kilocalories FROM daily_health_summary "
    "WHERE date < %s AND bmr_kilocalories > 1500 "
    "ORDER BY date DESC LIMIT 1",
    (today,),
)
```

**Step 2: Commit**

```bash
git add sync/src/nutrition_engine/generate_today.py
git commit -m "fix(nutrition): use yesterday's full-day BMR in generate_today"
```

---

### Task 3: Scale macros on extreme deficit days

**Files:**
- Modify: `web/app/api/nutrition/plan/route.ts:301-312`

**Step 1: Add proportional scaling after macro computation**

After line 304 (the `dayTargets.carbs` computation), add:

```ts
// Scale protein+fat down if they exceed calorie budget (extreme deficit days)
const macroFloorCal = dayTargets.protein * 4 + dayTargets.fat * 9;
if (macroFloorCal > dayTargets.calories && dayTargets.calories > 0) {
  const scale = dayTargets.calories / macroFloorCal;
  dayTargets.protein = Math.round(dayTargets.protein * scale);
  dayTargets.fat = Math.round(dayTargets.fat * scale);
  dayTargets.carbs = 0;
}
```

**Step 2: Commit**

```bash
git add web/app/api/nutrition/plan/route.ts
git commit -m "fix(nutrition): scale macros proportionally on extreme deficit days"
```

---

### Task 4: Plan API uses profile deficit as primary source

**Files:**
- Modify: `web/app/api/nutrition/plan/route.ts:294,371`

**Step 1: Change deficit logic**

Replace line 294:
```ts
dayTargets.calories = Math.round(baseBmr + adjustedStepCalories + effectiveRunCal + effectiveGymCal - (Number(plan.deficit_used) || defaultDeficit));
```

With:
```ts
// Use profile deficit unless manual_override (then use stored deficit_used)
const effectiveDeficit = manualOverride
  ? (Number(plan.deficit_used) || defaultDeficit)
  : defaultDeficit;
dayTargets.calories = Math.round(baseBmr + adjustedStepCalories + effectiveRunCal + effectiveGymCal - effectiveDeficit);
```

Also update the breakdown line 371:
```ts
deficit: Number(plan.deficit_used) || defaultDeficit,
```
Change to:
```ts
deficit: effectiveDeficit,
```

**Step 2: Commit**

```bash
git add web/app/api/nutrition/plan/route.ts
git commit -m "fix(nutrition): use profile deficit as primary, stored only for manual_override"
```

---

### Task 5: Use actual steps for past/closed days

**Files:**
- Modify: `web/app/api/nutrition/plan/route.ts:230-232`

**Step 1: Use actual steps when day is closed or in the past**

After line 228 (where `actualSteps` is fetched), replace lines 230-232:
```ts
// Recompute step calories from scratch using weight-based formula
const calPerStep = 0.0005 * weightKg;
const rawStepCalories = Math.round(expectedSteps * calPerStep);
```

With:
```ts
// Use actual steps for closed/past days, expected for current/future
const calPerStep = 0.0005 * weightKg;
const isClosed = plan?.status === "closed";
const isPast = date < new Date().toISOString().slice(0, 10);
const stepsForCalc = (isClosed || isPast) && actualSteps !== null ? actualSteps : expectedSteps;
const rawStepCalories = Math.round(stepsForCalc * calPerStep);
```

**Step 2: Also update the breakdown to reflect which steps were used**

In the breakdown object, add a field after `actualSteps`:
```ts
stepsUsedForCalc: stepsForCalc,
stepsSource: (isClosed || isPast) && actualSteps !== null ? "actual" : "expected",
```

**Step 3: Commit**

```bash
git add web/app/api/nutrition/plan/route.ts
git commit -m "fix(nutrition): use actual steps for calorie calc on past/closed days"
```

---

### Task 6: Manual override equation display

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx:338-351`

**Step 1: Add manualOverride to breakdown and show different text**

First, add `manualOverride` to the breakdown object in `plan/route.ts` (in the breakdown object around line 353):
```ts
manualOverride,
```

Then in `nutrition-dashboard.tsx`, replace lines 339-351 (the one-line equation):
```tsx
{dataReady && breakdown && (
  <div className="text-[10px] text-muted-foreground text-center">
    {breakdown.manualOverride ? (
      <>Manual target: {breakdown.targetIntake} kcal</>
    ) : (
      <>
        {breakdown.bmr} BMR
        {breakdown.stepCalories > 0 && ` + ${breakdown.stepCalories} steps`}
        {breakdown.runCalories > 0 && ` + ${breakdown.runCalories} run${breakdown.runActual ? " \u2713" : " ~"}`}
        {breakdown.gymBreakdown && breakdown.gymBreakdown.length > 0
          ? breakdown.gymBreakdown.map((w: any) => ` + ${w.calories} ${w.title}${w.actual ? " \u2713" : " ~"}`).join("")
          : breakdown.gymCalories > 0 ? ` + ${breakdown.gymCalories} gym` : ""}
        {breakdown.deficit > 0 && ` \u2212 ${breakdown.deficit} deficit`}
        {breakdown.drinkCalories > 0 && ` \u2212 ${breakdown.drinkCalories} drinks`}
        {` = ${breakdown.targetIntake}`}
      </>
    )}
  </div>
)}
```

**Step 2: Commit**

```bash
git add web/app/api/nutrition/plan/route.ts web/components/nutrition-dashboard.tsx
git commit -m "fix(nutrition): show 'Manual target' instead of fake equation on override days"
```

---

### Task 7: Locked day badge + dimmed toggles

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx:278-283`
- Modify: `web/components/activity-selector.tsx`

**Step 1: Add locked badge next to date**

In `nutrition-dashboard.tsx`, after the "Closed" badge (line 278-283), add:
```tsx
{breakdown?.manualOverride && !isClosed && (
  <Badge variant="secondary" className="gap-1 text-amber-500 border-amber-500/30">
    <Lock className="h-3 w-3" />
    Offset Plan
  </Badge>
)}
```

**Step 2: Pass manualOverride to ActivitySelector**

In the ActivitySelector usage (around line 577), add prop:
```tsx
disabled={breakdown?.manualOverride}
```

**Step 3: In ActivitySelector, dim when disabled**

In `web/components/activity-selector.tsx`, accept a `disabled` prop and wrap the component content in a div with conditional opacity:
```tsx
<div className={disabled ? "opacity-50 pointer-events-none" : ""}>
  {/* existing content */}
  {disabled && (
    <div className="text-[10px] text-amber-500 mt-1">Target locked — offset plan</div>
  )}
</div>
```

**Step 4: Commit**

```bash
git add web/components/nutrition-dashboard.tsx web/components/activity-selector.tsx
git commit -m "feat(nutrition): show offset plan badge and dim activity toggles on locked days"
```

---

### Task 8: Fix cancel-deletes-meal bug

**Files:**
- Modify: `web/components/meal-card.tsx:719-746`

**Context:** When clicking "Edit" on a meal, line 744 calls `handleDelete(detailMeal.id)` immediately, then opens the compose view. If user cancels the compose, the meal is permanently gone.

**Step 1: Store the editing meal ID instead of deleting**

Add state variable near line 130:
```tsx
const [editingMealId, setEditingMealId] = useState<number | null>(null);
```

**Step 2: Change the edit flow (around line 719-746)**

Instead of calling `handleDelete(detailMeal.id)` on edit, store the ID:
```tsx
setEditingMealId(detailMeal.id);
```

Remove the `handleDelete(detailMeal.id)` call from the edit handler.

**Step 3: Delete old meal only on save**

In the `handleLogMeal` function (the save handler), before the POST to create the new meal, add:
```tsx
if (editingMealId) {
  await fetch(`/api/nutrition/log-meal?id=${editingMealId}`, { method: "DELETE" });
  setEditingMealId(null);
}
```

**Step 4: Restore on cancel**

In `handleComposeCancel`, clear the editing state without deleting:
```tsx
const handleComposeCancel = () => {
  setComposedPortions(null);
  setSelectedIngredients(new Set());
  setShowCompose(false);
  setEditingMealId(null); // Don't delete — just discard the edit
};
```

**Step 5: Commit**

```bash
git add web/components/meal-card.tsx
git commit -m "fix(nutrition): cancel during edit no longer deletes the original meal"
```

---

### Task 9: Hide macro bars during SSR flash

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx:512-523`

**Step 1: Wrap macro bars in dataReady check**

The macro bars (lines 512-523) should only render after API data loads. Wrap them:

```tsx
{dataReady ? (
  <div className="grid gap-2 pt-1">
    <MacroBar label="Protein" ... />
    <MacroBar label="Carbs" ... />
    <MacroBar label="Fat" ... />
    {targetFiber > 0 && <MacroBar label="Fiber" ... />}
  </div>
) : (
  <div className="h-24" /> {/* placeholder height */
)}
```

**Step 2: Commit**

```bash
git add web/components/nutrition-dashboard.tsx
git commit -m "fix(nutrition): hide macro bars until API data loads to prevent flash"
```

---

### Task 10: Playwright verification

Navigate to all 4 days (Mar 14-17) and verify:
- Sunday: shows "Manual target: 912 kcal", "🔒 Offset Plan" badge, dimmed toggles, scaled macros (no 0g carbs)
- Monday: shows "Manual target: 1679 kcal", badge, 0 remaining, correct breakfast
- Tuesday: shows "Manual target: 2518 kcal", badge
- Saturday: normal equation (no badge), correct BMR/steps/run

---

## Summary

| Task | File(s) | Fix |
|------|---------|-----|
| 1 | generate_today.py | Skip manual_override days |
| 2 | generate_today.py | Use yesterday's full BMR |
| 3 | plan/route.ts | Scale macros on extreme deficit |
| 4 | plan/route.ts | Profile deficit as primary source |
| 5 | plan/route.ts | Actual steps for past days |
| 6 | plan/route.ts + dashboard.tsx | "Manual target" equation |
| 7 | dashboard.tsx + activity-selector.tsx | 🔒 badge + dimmed toggles |
| 8 | meal-card.tsx | Cancel doesn't delete meal |
| 9 | dashboard.tsx | Hide macro flash on SSR |
| 10 | — | Playwright verification |
