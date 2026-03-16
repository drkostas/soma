# Auto-Rebalance Meals — Design

## What it does

When a meal is logged or edited, automatically adjust remaining unlogged meals to keep the day on target. Show a notification of what changed.

## How it works

1. User logs/edits a meal (e.g., adds a gel to lunch)
2. Plan API recomputes remaining budget: `dayTarget - sum(logged meals)`
3. For each unlogged future meal, re-run the portion solver with the updated slot budget
4. Save the adjusted portions back to meal_log
5. Show toast: "Dinner salmon adjusted 172g → 148g to stay on target"

## Rebalancing strategy: protein-preserving

When reducing a meal's calories, shrink in this order:
1. **Carb sources first** (rice, oats, banana, bread) — most expendable on a cut
2. **Fat sources second** (oil, avocado, cheese) — reduce if needed
3. **Protein sources last** (salmon, chicken, whey, yogurt) — protect as long as possible
4. **Vegetables never** — keep all veggies for fiber/volume/satiety

Implementation: tag each ingredient with a `shrink_priority` (carb=1, fat=2, protein=3, vegetable=999). Sort by priority, reduce highest-priority ingredients first until the calorie delta is absorbed.

## Trigger conditions

Auto-rebalance fires when:
- A meal is logged (new)
- A meal is edited (portion changed)
- A meal is deleted
- A drink is logged (alcohol offset)
- A quick-add food is added

Does NOT fire when:
- Day is closed
- All meals are already logged (nothing to adjust)

## Works with manual_override

On offset plan days, the locked `target_calories` is the constraint. Auto-rebalance works within that target.

## Notification

Toast notification (3-5 seconds, dismissable):
```
"Adjusted remaining meals: dinner salmon 172g → 148g, presleep banana 70g → 50g"
```

## Files to modify

- `web/app/api/nutrition/rebalance/route.ts` — new API endpoint
- `web/components/nutrition-dashboard.tsx` — call rebalance after meal changes
- `web/lib/portion-solver.ts` — add shrink_priority-based reduction logic
- `sync/src/nutrition_engine/seed_data.py` — add shrink_priority to ingredients
