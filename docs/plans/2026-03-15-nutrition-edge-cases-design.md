# Nutrition Edge Cases & Body Comp Trajectory — Design

## Fix 1: Protect manual_override from generate_today.py

`generate_today.py` uses `ON CONFLICT (date) DO UPDATE` which overwrites manual targets. Fix: query the existing row before upsert. If `manual_override = TRUE`, skip entirely.

```python
cur.execute("SELECT manual_override FROM nutrition_day WHERE date = %s", (today,))
row = cur.fetchone()
if row and row[0]:
    print(f"Skipping {today} — manual_override is set")
    return
```

## Fix 2: Manual override equation display

Currently shows a fake equation that doesn't add up. When `manual_override = true`, the one-line equation in the dashboard should instead show:

```
Manual target: 912 kcal (offset plan)
```

In the expanded breakdown, still show the component values (BMR, steps, run, gym) for observability, but label the target as "Manual target" instead of making it look like a formula result.

**File:** `web/components/nutrition-dashboard.tsx` — the one-line equation rendering (around line 334).

## Fix 3: Locked day indicator

When `manual_override = true`:
- Show a badge next to the date header: `🔒 Offset Plan` (same style as the existing "Closed" badge)
- Dim the activity toggles (run ON/OFF, gym chips) with reduced opacity
- Add subtle text under toggles: "Target locked — offset plan"

**Files:** `web/components/nutrition-dashboard.tsx` (badge), `web/components/activity-selector.tsx` (dim toggles)

## Fix 4: Scale macros on extreme deficit days

When `dayTargets.calories < protein_cal + fat_cal` (i.e., protein×4 + fat×9 > target), scale both down proportionally:

```ts
const proteinCal = dayTargets.protein * 4;
const fatCal = dayTargets.fat * 9;
const macroFloor = proteinCal + fatCal;
if (macroFloor > dayTargets.calories) {
  const scale = dayTargets.calories / macroFloor;
  dayTargets.protein = Math.round(dayTargets.protein * scale);
  dayTargets.fat = Math.round(dayTargets.fat * scale);
  dayTargets.carbs = 0;
}
```

This preserves the protein:fat ratio while making targets achievable.

**File:** `web/app/api/nutrition/plan/route.ts` — after macro computation.

## Fix 5: Adaptive deficit from profile

### 5a: generate_today.py reads profile deficit
Replace any hardcoded deficit with:
```python
cur.execute("SELECT daily_deficit FROM nutrition_profile WHERE id = 1")
deficit = cur.fetchone()[0] or 500
```

### 5b: plan API uses profile deficit as primary source
Change the deficit computation from `Number(plan.deficit_used) || defaultDeficit` to: always use `defaultDeficit` (from profile) UNLESS `manual_override = true` (then use stored `deficit_used`).

This ensures changing the profile deficit immediately affects all non-manual days.

### 5c: Adaptive deficit recalculation in generate_today.py
After reading weight_log, compute:
```python
# Get smoothed weight (7-day EMA)
# Compute remaining fat to lose = (smoothed_weight × current_bf%) - (target_weight × target_bf%)
# remaining_days = (target_date - today).days
# adaptive_deficit = clamp(remaining_fat_kg * 7700 / remaining_days, 400, 1200)
# Write to nutrition_profile.daily_deficit
```

## Fix 6: Body Comp Trajectory Tab

### Location
New tab on `/nutrition` page, alongside the daily nutrition view. Tab pattern like the Playlist page (day view | trajectory).

### API endpoint
`GET /api/nutrition/body-comp` returns:
```json
{
  "profile": { "weight_kg", "target_bf_pct", "target_date", "estimated_bf_pct", "daily_deficit" },
  "weights": [{ "date", "weight_kg", "smoothed_kg" }],
  "projection": [{ "date", "projected_kg", "projected_bf_pct" }],
  "status": { "on_track": true, "days_ahead": 2, "current_deficit": 782, "needed_deficit": 782 }
}
```

### Chart design
- **X-axis:** Date timeline, today to target_date + 2 weeks buffer. Ticks every 2 weeks. Left extends ~2 weeks for history.
- **Y-axis left:** Weight in kg (range: target_weight - 3 to current_weight + 2)
- **Y-axis right:** BF% (range: target_bf - 2 to current_bf + 2)
- **Lines:**
  - Solid blue: actual weight (dots for daily weigh-ins, line for smoothed EMA)
  - Dashed blue: projected weight (from today to target date)
  - Solid orange: estimated BF% (derived from smoothed weight + lean mass)
  - Dashed orange: projected BF%
  - Horizontal dotted: target weight and target BF% lines
  - Shaded green zone: ±1kg from projected (on-track corridor)
- **Hover tooltip:**
  - Date
  - Weight (actual or projected)
  - Estimated BF%
  - Daily deficit at that point
  - "X days ahead/behind schedule"

### Status card (above chart, always visible)
```
72.1kg → 71.3kg goal    |    15.8% → 15% BF
782 cal/day deficit      |    On track · Jun 1
```
Turns amber when behind schedule with recalculated realistic date.

### Guardrails
- Deficit min: 400 kcal/day (below = too slow, extend timeline instead)
- Deficit max: 1200 kcal/day (above = show "target date at risk" + realistic date)
- Smoothing: 7-day exponential moving average on weight

## Fix 7: Cancel deletes meal bug

When editing a meal, clicking "Cancel" currently deletes the meal instead of restoring it. The issue is likely in `MealCard` — the edit flow removes the meal from state to show the compose view, and cancel doesn't restore it.

**Fix:** Store the original meal data before entering edit mode. On cancel, restore the stored data. On save, discard the stored data.

**File:** `web/components/meal-card.tsx`

## Fix 8: Meal distribution (already done)

Updated to: breakfast 28% / lunch 25% / dinner 37% / pre-sleep 10%.
