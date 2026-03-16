# Prep Summary — Design

## What it does

Shows total grams needed for ingredients that appear in 2+ meals on the same day. Helps you weigh and cook everything at once, then portion into meals.

## Example

Today (Mon Mar 16):
- Broccoli: 80g + 180g = **260g raw** (lunch + dinner)
- Salmon: 143g + 172g = **315g raw** (lunch + dinner)
- Cherry Tomatoes: 40g + 96g = **136g raw** (lunch + dinner)

Cucumber (245g, lunch only) is NOT shown — single meal only.

## Data source

Computed client-side from the `meals` array already loaded in `NutritionDashboard`. No new API needed. Group meal items by `ingredient_id`, sum grams, filter to count >= 2.

## Responsive behavior

- **Desktop (lg+):** Card in the left column, below the activity selector. Always visible. Title: "Prep List".
- **Mobile (<lg):** Collapsible section above the meal cards, collapsed by default. Small toggle: "▼ Prep list (3 items)".

## Component

New component: `web/components/prep-summary.tsx`

Props:
```tsx
interface PrepSummaryProps {
  meals: Meal[];
}
```

Logic:
```tsx
// Group items by ingredient_id across all meals
// Sum grams (use raw grams, not cooked)
// Filter to ingredients appearing in 2+ meals
// Display: ingredient name, total grams, "(meal1 + meal2)" breakdown
```

Display per ingredient:
```
🥦 Broccoli    260g raw    (80g lunch + 180g dinner)
🐟 Salmon      315g raw    (143g lunch + 172g dinner)
🍅 Tomatoes    136g raw    (40g lunch + 96g dinner)
```

## Integration

In `nutrition-dashboard.tsx`:
- Desktop: render `<PrepSummary>` in left column after ActivitySelector
- Mobile: render above meal cards with collapsible wrapper
- Only render if there are any repeated ingredients (hide entirely if none)
