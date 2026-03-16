# NumberInput Component + Desktop Layout — Design

## Feature 1: Reusable NumberInput Component

Replace all +/- button pairs with a unified `<NumberInput>` component that provides:

- **Tappable number** — tap the displayed value to enter edit mode (inline text field, auto-select all)
- **Slider** — horizontal slider underneath for drag adjustment
- **+/- buttons** — small buttons on slider edges for fine-tuning
- **Props**: `value`, `onChange`, `min`, `max`, `step`, `label?`, `suffix?` (e.g., "g", "steps", "x")

### Usages

| Context | min | max | step | suffix |
|---------|-----|-----|------|--------|
| Expected steps | 3000 | 30000 | 250 | steps |
| Ingredient grams | 0 | 500 | 5 | g |
| Preset multiplier | 0.5 | 2.0 | 0.05 | x |

### Behavior
- Tap number → text field, keyboard opens (type="number"), blur or Enter saves
- Slider drag → live update (debounced onChange)
- +/- buttons → increment/decrement by `step`
- Value clamped to [min, max]

### File
- Create: `web/components/number-input.tsx`
- Modify: `web/components/activity-selector.tsx` (replace steps +/-)
- Modify: `web/components/compose-meal-view.tsx` (replace portion +/-)
- Modify: `web/components/meal-card.tsx` (replace preset multiplier +/-)

## Feature 2: Desktop Two-Column Layout

### Breakpoint
- Below `lg` (1024px): current mobile single-column layout unchanged
- At `lg` and above: two-column layout

### Layout (desktop)
```
┌──────────────────────────┬──────────────────────────────┐
│  Budget Card (sticky)    │  Meal Cards (scrollable)     │
│  - always expanded       │  - breakfast                 │
│  - larger text (5xl)     │  - lunch                     │
│  - full breakdown        │  - dinner                    │
│  - per-meal budget       │  - pre-sleep                 │
│  - 7-day trend           │  - during workout            │
│                          │  - drinks                    │
│  Activity Selector       │  - close day button          │
│  - run toggle            │                              │
│  - gym chips             │                              │
│  - expected steps        │                              │
│  Training/health strip   │                              │
└──────────────────────────┴──────────────────────────────┘
```

### Sizing
- Left column: ~400px fixed
- Right column: flex, max-w-lg
- Container: max-w-5xl mx-auto
- Budget card text: 4xl mobile → 5xl desktop
- Macro bars: h-2 mobile → h-3 desktop
- Details always expanded on desktop (budgetExpanded forced true)

### Implementation
- Modify: `web/components/nutrition-dashboard.tsx`
- Use Tailwind responsive classes (lg:grid lg:grid-cols-[400px_1fr] lg:gap-6)
- Left column: lg:sticky lg:top-4 lg:self-start
- Mobile: unchanged single column

### Visual verification
- Screenshot at 390x844 (iPhone) — must look identical to current
- Screenshot at 1440x900 (desktop) — verify two-column, spacing, text sizes
