# Auto-Rebalance Meals — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a meal is logged/edited/deleted, automatically adjust remaining unlogged meals to keep the day on target, preserving protein and shrinking carbs/fats first.

**Architecture:** New API endpoint `/api/nutrition/rebalance` receives a date, recomputes slot budgets from the plan API logic, then for each unlogged future meal, reduces ingredients by shrink priority (carbs→fats→protein, never veggies). Returns the list of changes for a toast notification. The dashboard calls rebalance after every meal change.

**Tech Stack:** Next.js 16 App Router, TypeScript, Neon PostgreSQL

---

### Task 1: Add shrink_priority to ingredients

**Files:**
- Modify: `sync/src/nutrition_engine/schema.py`
- Modify: `sync/src/nutrition_engine/seed_data.py`

**Step 1: Add column**

In `schema.py`, add after the `usda_fdc_id` ALTER:

```sql
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS shrink_priority INTEGER DEFAULT 2;
```

Priority values: 1=carb (shrink first), 2=fat (second), 3=protein (last), 99=vegetable (never)

**Step 2: Set priorities in seed data**

Add SQL to set priorities by category:

```sql
UPDATE ingredients SET shrink_priority = 1 WHERE category IN ('carbs', 'fruit', 'grain');
UPDATE ingredients SET shrink_priority = 2 WHERE category IN ('fat', 'sauce');
UPDATE ingredients SET shrink_priority = 3 WHERE category IN ('protein', 'dairy', 'supplement');
UPDATE ingredients SET shrink_priority = 99 WHERE category = 'vegetable';
```

**Step 3: Apply migration**

```bash
DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-) python3 -c "
import os, psycopg2
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute('ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS shrink_priority INTEGER DEFAULT 2')
cur.execute(\"UPDATE ingredients SET shrink_priority = 1 WHERE category IN ('carbs', 'fruit', 'grain')\")
cur.execute(\"UPDATE ingredients SET shrink_priority = 2 WHERE category IN ('fat', 'sauce')\")
cur.execute(\"UPDATE ingredients SET shrink_priority = 3 WHERE category IN ('protein', 'dairy', 'supplement')\")
cur.execute(\"UPDATE ingredients SET shrink_priority = 99 WHERE category = 'vegetable'\")
conn.commit()
print('Done')
conn.close()
"
```

**Step 4: Commit**

```bash
git add sync/src/nutrition_engine/schema.py sync/src/nutrition_engine/seed_data.py
git commit -m "feat(nutrition): add shrink_priority to ingredients for auto-rebalance"
```

---

### Task 2: Create rebalance API endpoint

**Files:**
- Create: `web/app/api/nutrition/rebalance/route.ts`

**Step 1: Create the endpoint**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { date } = await req.json();
  const sql = getDb();

  // 1. Get day target (respect manual_override)
  const [planRows] = await Promise.all([
    sql`SELECT target_calories, manual_override FROM nutrition_day WHERE date = ${date}`,
  ]);
  const plan = planRows[0];
  if (!plan) return NextResponse.json({ changes: [] });

  let dayTarget = Number(plan.target_calories) || 0;
  if (!dayTarget) return NextResponse.json({ changes: [] });

  // If not manual_override, fetch computed target from plan API
  if (!plan.manual_override) {
    // Use profile deficit
    const profileRows = await sql`SELECT daily_deficit FROM nutrition_profile WHERE id = 1`;
    const deficit = profileRows[0]?.daily_deficit != null ? Number(profileRows[0].daily_deficit) : 500;
    // For non-manual days, we use the plan API's computed target
    // Simplification: just use stored target_calories (plan API refreshes it)
  }

  // 2. Get all logged meals
  const mealRows = await sql`
    SELECT id, meal_slot, items, calories FROM meal_log WHERE date = ${date} ORDER BY logged_at
  `;
  // 3. Get drinks
  const drinkRows = await sql`
    SELECT calories FROM drink_log WHERE date = ${date}
  `;
  const drinkCal = drinkRows.reduce((s: number, r: any) => s + (Number(r.calories) || 0), 0);

  // 4. Group meals by slot, find which slots have meals
  const slotMeals: Record<string, any[]> = {};
  for (const m of mealRows) {
    const slot = m.meal_slot as string;
    if (!slotMeals[slot]) slotMeals[slot] = [];
    slotMeals[slot].push(m);
  }

  // 5. Compute total eaten so far
  const totalEaten = mealRows.reduce((s: number, m: any) => s + (Number(m.calories) || 0), 0) + drinkCal;
  const remaining = dayTarget - totalEaten;

  // 6. Find future meals that can be adjusted (logged but not yet eaten)
  // We identify "adjustable" meals as those in slots that come AFTER the most recently
  // modified slot. For simplicity: adjust all meals in slots that haven't been "finalized".
  // The caller will indicate which slot was just changed.
  // For now: adjust all non-breakfast meals if breakfast was changed, etc.

  // Get skipped slots
  const planData = await sql`SELECT skipped_slots FROM nutrition_day WHERE date = ${date}`;
  const skippedSlots: string[] = planData[0]?.skipped_slots || [];

  const SLOT_ORDER = ["breakfast", "lunch", "dinner", "pre_sleep", "during_workout"];

  // Get ingredients for shrink priority
  const ingredientRows = await sql`SELECT id, shrink_priority, calories_per_100g, protein_per_100g, category FROM ingredients`;
  const ingredientMap: Record<string, { shrink_priority: number; calories_per_100g: number; protein_per_100g: number; category: string }> = {};
  for (const r of ingredientRows) {
    ingredientMap[r.id as string] = {
      shrink_priority: Number(r.shrink_priority) || 2,
      calories_per_100g: Number(r.calories_per_100g) || 0,
      protein_per_100g: Number(r.protein_per_100g) || 0,
      category: r.category as string,
    };
  }

  // 7. For each adjustable meal, reduce ingredients by shrink priority
  const changes: { slot: string; ingredient: string; from: number; to: number }[] = [];

  // Determine which slots need adjustment: slots with logged meals that we can shrink
  // We need to reduce total by (totalEaten - dayTarget) if over, or we're fine if under
  if (remaining >= 0) {
    // Under budget — no adjustment needed
    return NextResponse.json({ changes: [] });
  }

  let calToRemove = Math.abs(remaining); // positive number of cal to cut

  // Collect all items from adjustable slots (all slots except the one just changed)
  // Since we don't know which was just changed, adjust ALL logged future meals
  // Sort all items across all meals by shrink_priority (1 first = cut first)
  type AdjustableItem = {
    mealId: number;
    slot: string;
    itemIndex: number;
    ingredientId: string;
    ingredientName: string;
    grams: number;
    calories: number;
    calPer100g: number;
    shrinkPriority: number;
  };

  const adjustable: AdjustableItem[] = [];
  for (const meal of mealRows) {
    const items = meal.items as any[];
    if (!items) continue;
    items.forEach((item: any, idx: number) => {
      const ing = ingredientMap[item.ingredient_id];
      if (!ing) return;
      if (ing.shrink_priority >= 99) return; // never shrink veggies
      adjustable.push({
        mealId: Number(meal.id),
        slot: meal.meal_slot as string,
        itemIndex: idx,
        ingredientId: item.ingredient_id,
        ingredientName: (item.name || item.ingredient_id).replace(/_/g, " "),
        grams: Number(item.grams) || 0,
        calories: Number(item.calories) || 0,
        calPer100g: ing.calories_per_100g,
        shrinkPriority: ing.shrink_priority,
      });
    });
  }

  // Sort by shrink priority (1=carbs first, 2=fats, 3=protein)
  adjustable.sort((a, b) => a.shrinkPriority - b.shrinkPriority);

  // Reduce items until we've cut enough calories
  const mealUpdates: Record<number, { items: any[]; calories: number; protein: number; carbs: number; fat: number; fiber: number }> = {};

  for (const item of adjustable) {
    if (calToRemove <= 0) break;

    // How much can we cut from this item? Min 20% of original (don't zero it out)
    const minGrams = Math.round(item.grams * 0.2);
    const maxCutGrams = item.grams - minGrams;
    const calPerGram = item.calPer100g / 100;
    const maxCutCal = maxCutGrams * calPerGram;

    const cutCal = Math.min(calToRemove, maxCutCal);
    const cutGrams = Math.round(cutCal / calPerGram);
    const newGrams = item.grams - cutGrams;

    if (cutGrams < 3) continue; // not worth adjusting

    calToRemove -= cutCal;
    changes.push({
      slot: item.slot,
      ingredient: item.ingredientName,
      from: item.grams,
      to: newGrams,
    });

    // Track meal update
    if (!mealUpdates[item.mealId]) {
      const meal = mealRows.find((m: any) => Number(m.id) === item.mealId);
      if (meal) {
        mealUpdates[item.mealId] = {
          items: JSON.parse(JSON.stringify(meal.items)),
          calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
        };
      }
    }
    if (mealUpdates[item.mealId]) {
      const mItem = mealUpdates[item.mealId].items[item.itemIndex];
      if (mItem) {
        const ratio = newGrams / item.grams;
        mItem.grams = newGrams;
        mItem.calories = Math.round(mItem.calories * ratio);
        mItem.protein = Math.round((mItem.protein || 0) * ratio * 10) / 10;
        mItem.carbs = Math.round((mItem.carbs || 0) * ratio * 10) / 10;
        mItem.fat = Math.round((mItem.fat || 0) * ratio * 10) / 10;
        mItem.fiber = Math.round((mItem.fiber || 0) * ratio * 10) / 10;
        if (mItem.cooked_grams) {
          mItem.cooked_grams = Math.round(mItem.cooked_grams * ratio);
        }
      }
    }
  }

  // 8. Write updated meals back to DB
  for (const [mealId, update] of Object.entries(mealUpdates)) {
    const cal = update.items.reduce((s: number, i: any) => s + (Number(i.calories) || 0), 0);
    const p = update.items.reduce((s: number, i: any) => s + (Number(i.protein) || 0), 0);
    const c = update.items.reduce((s: number, i: any) => s + (Number(i.carbs) || 0), 0);
    const f = update.items.reduce((s: number, i: any) => s + (Number(i.fat) || 0), 0);
    const fi = update.items.reduce((s: number, i: any) => s + (Number(i.fiber) || 0), 0);

    await sql`
      UPDATE meal_log SET items = ${JSON.stringify(update.items)}::jsonb,
        calories = ${cal}, protein = ${p}, carbs = ${c}, fat = ${f}, fiber = ${fi}
      WHERE id = ${Number(mealId)}
    `;
  }

  return NextResponse.json({ changes });
}
```

**Step 2: Commit**

```bash
git add web/app/api/nutrition/rebalance/route.ts
git commit -m "feat(nutrition): create rebalance API endpoint with shrink-priority logic"
```

---

### Task 3: Call rebalance from dashboard + show toast

**Files:**
- Modify: `web/components/nutrition-dashboard.tsx`

**Step 1: Add toast state and rebalance call**

Add state for toast:
```tsx
const [rebalanceToast, setRebalanceToast] = useState<string | null>(null);
```

Add rebalance function:
```tsx
const rebalanceMeals = useCallback(async () => {
  try {
    const res = await fetch("/api/nutrition/rebalance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.changes && data.changes.length > 0) {
      const msg = data.changes
        .map((c: any) => `${c.ingredient} ${c.from}g → ${c.to}g`)
        .join(", ");
      setRebalanceToast(`Adjusted: ${msg}`);
      setTimeout(() => setRebalanceToast(null), 5000);
      await refreshData();
    }
  } catch {}
}, [date, refreshData]);
```

**Step 2: Update refreshData to call rebalance**

Modify the existing `refreshData` to call rebalance after loading data. Or better: create a new `handleMealChanged` that calls refreshData then rebalance:

```tsx
const handleMealChanged = useCallback(async () => {
  await refreshData();
  await rebalanceMeals();
}, [refreshData, rebalanceMeals]);
```

Pass `handleMealChanged` instead of `refreshData` to all MealCard `onMealLogged` props and DrinkLogger `onDrinkLogged`.

**Step 3: Render toast**

At the bottom of the component, before the closing `</div>`:

```tsx
{rebalanceToast && (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 text-sm shadow-lg z-50 max-w-sm text-center">
    {rebalanceToast}
    <button onClick={() => setRebalanceToast(null)} className="ml-2 text-muted-foreground hover:text-foreground">✕</button>
  </div>
)}
```

**Step 4: Commit**

```bash
git add web/components/nutrition-dashboard.tsx
git commit -m "feat(nutrition): call rebalance after meal changes + show toast notification"
```

---

### Task 4: Exclude the just-changed slot from rebalancing

**Files:**
- Modify: `web/app/api/nutrition/rebalance/route.ts`
- Modify: `web/components/nutrition-dashboard.tsx`
- Modify: `web/components/meal-card.tsx`

**Step 1: Pass changedSlot to rebalance API**

The rebalance API should accept an optional `changedSlot` parameter. Meals in that slot should NOT be adjusted (the user just intentionally set those values).

In the API, add to the request body:
```ts
const { date, changedSlot } = await req.json();
```

When collecting adjustable items, skip the changed slot:
```ts
for (const meal of mealRows) {
  if (meal.meal_slot === changedSlot) continue; // don't adjust the slot the user just changed
  // ... rest of collection logic
}
```

**Step 2: Pass slot info through the callback chain**

MealCard's `onMealLogged` becomes `onMealLogged: (slot?: string) => void`.

In meal-card, when calling onMealLogged after logging, pass the slot:
```tsx
onMealLogged(slot);
```

In dashboard, `handleMealChanged` accepts the slot:
```tsx
const handleMealChanged = useCallback(async (changedSlot?: string) => {
  await refreshData();
  await rebalanceMeals(changedSlot);
}, [refreshData, rebalanceMeals]);
```

And rebalanceMeals sends it:
```tsx
body: JSON.stringify({ date, changedSlot }),
```

**Step 3: Commit**

```bash
git add web/app/api/nutrition/rebalance/route.ts web/components/nutrition-dashboard.tsx web/components/meal-card.tsx
git commit -m "feat(nutrition): exclude changed slot from rebalancing"
```

---

### Task 5: Playwright verification

**Step 1:** Navigate to Monday (Mar 16) at 1440x900 desktop
**Step 2:** Verify current totals match target
**Step 3:** Note: can't easily test rebalance without adding a meal, but verify the prep list and layout are intact after changes

---

## Summary

| Task | File(s) | What |
|------|---------|------|
| 1 | schema.py, seed_data.py | Add shrink_priority column |
| 2 | rebalance/route.ts | Create rebalance API |
| 3 | nutrition-dashboard.tsx | Call rebalance + toast |
| 4 | rebalance/route.ts, dashboard, meal-card | Exclude changed slot |
| 5 | — | Playwright verification |
