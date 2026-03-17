# Body Comp Trajectory Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 13 visual, data, and UX issues in the body comp trajectory charts.

**Architecture:** All fixes are in two files: `body-comp-chart.tsx` (chart component) and `body-comp/route.ts` (API). No new files, no schema changes.

**Tech Stack:** Next.js, TypeScript, Recharts, Tailwind CSS 4

---

### Task 1: Fix CSS color bug + chart visibility

**File:** `web/components/body-comp-chart.tsx`

The weight chart is invisible because `hsl(var(--primary))` wraps an oklch value which is invalid CSS. Replace ALL `hsl(var(--primary))` and `hsl(var(--border))` with hardcoded colors.

**Colors to use:**
- Weight chart: `#3b82f6` (blue)
- BF% chart: `#f97316` (orange) — already correct
- Target/goal lines: `#22c55e` (green) for both charts
- Grid: `rgba(255,255,255,0.1)`
- Axis text: `rgba(255,255,255,0.5)`
- Tooltip bg: `rgba(0,0,0,0.9)`, border: `rgba(255,255,255,0.2)`

Replace on these lines:
- CartesianGrid `stroke` → `"rgba(255,255,255,0.1)"`
- XAxis/YAxis `tick.fill` → `"rgba(255,255,255,0.5)"`
- Tooltip `contentStyle` → hardcoded dark bg/border
- ReferenceLine `stroke` and label `fill` → `"#22c55e"` (green for target)
- Weight `actual` Line → stroke `"#3b82f6"`, dot fill `"#3b82f6"`
- Weight `smoothed` Line → stroke `"#3b82f6"`, strokeWidth 2
- Weight `projected` Line → stroke `"#3b82f6"`, strokeDasharray, opacity 0.6

Also on BF% chart:
- ReferenceLine → `"#22c55e"` (green, NOT orange — differentiate from projection)
- Keep BF% actual/projected as `"#f97316"` (orange)

**Commit:** `fix(trajectory): replace hsl(var(--primary)) with hardcoded colors to fix invisible weight chart`

---

### Task 2: Reduce X-axis ticks + bigger Y-axis labels

**File:** `web/components/body-comp-chart.tsx`

On both XAxis elements:
- Remove `interval="preserveStartEnd"` and `tickCount={6}`
- Add `interval="equidistantPreserveStart"` or just set `tickCount={7}`
- Actually simplest: use `interval={Math.ceil(chartData.length / 7)}` to show ~7 ticks

On both YAxis elements:
- Change tick fontSize from 10 to 12
- Change tick fill to `"rgba(255,255,255,0.6)"` (brighter)

On weight YAxis:
- Add `tickFormatter={(v: number) => \`\${v}kg\``}`

**Commit:** `fix(trajectory): reduce x-axis density, bigger y-axis labels, add kg unit`

---

### Task 3: Taller charts

**File:** `web/components/body-comp-chart.tsx`

- Weight chart: change `h-64` (256px) to `h-80` (320px)
- BF% chart: change `h-48` (192px) to `h-64` (256px)

**Commit:** `fix(trajectory): increase chart heights for better data readability`

---

### Task 4: Fix status card — actual weight, days remaining, weekly rate

**File:** `web/components/body-comp-chart.tsx`

Change the status card to show:
- **Latest actual weight** (not smoothed) as the primary number
- Smoothed in smaller text: `77.5kg (avg 78.8)`
- Add days remaining: `77 days left`
- Add weekly loss rate needed: `0.7 kg/week`

**File:** `web/app/api/nutrition/body-comp/route.ts`

Add to the response:
- `latestActualWeight`: the raw last weigh-in (not smoothed)
- `weeklyRate`: `fatToLose / (daysRemaining / 7)` in kg/week

Fix the BF% inconsistency: derive displayed BF% from the same weight used for display (latest actual, not smoothed).

**Commit:** `fix(trajectory): show actual weight + days remaining + weekly rate in status card`

---

### Task 5: Bridge projection gap

**File:** `web/app/api/nutrition/body-comp/route.ts`

Currently projection starts from `today`. If the last weigh-in was 3 days ago, there's a visual gap.

Fix: start the projection from the last actual weight date, using the last smoothed weight as the starting value. Change:
```ts
const projStart = new Date(today);
```
To:
```ts
const lastDate = weights.length > 0 ? weights[weights.length - 1].date : today;
const projStart = new Date(lastDate);
```

Also ensure the first projection point overlaps with the last actual data point so Recharts draws a continuous line.

**Commit:** `fix(trajectory): start projection from last weigh-in date to avoid gap`

---

### Task 6: Different colors for projection vs target on BF% chart

Already handled in Task 1 — target line uses green `#22c55e`, projection stays orange `#f97316`.

No separate commit needed.

---

### Task 7: Fix mobile status wrapping

**File:** `web/components/body-comp-chart.tsx`

The status info row (deficit · fat to lose · on track) wraps awkwardly on mobile. Change from `flex items-center gap-3` to a responsive layout:

```tsx
<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-3 text-xs">
```

This allows items to wrap cleanly on narrow screens.

**Commit:** `fix(trajectory): fix mobile status card text wrapping`

---

### Task 8: "cal" → "kcal"

**File:** `web/components/body-comp-chart.tsx`

Replace all instances of `cal/day` with `kcal/day`:
- Status card deficit display
- "Need X cal/day" behind-schedule message

**Commit:** `fix(trajectory): use kcal instead of cal for accuracy`

---

### Task 9: Add inline legend

**File:** `web/components/body-comp-chart.tsx`

Add a small legend below each chart title:

For weight chart:
```tsx
<div className="text-[10px] text-muted-foreground mb-2">
  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#3b82f6]" /> actual</span>
  <span className="mx-2">·</span>
  <span>━ smoothed</span>
  <span className="mx-2">·</span>
  <span>╌ projected</span>
  <span className="mx-2">·</span>
  <span className="text-[#22c55e]">╌ target</span>
</div>
```

For BF% chart, similar with orange colors.

**Commit:** `feat(trajectory): add inline chart legends`

---

### Task 10: Add context to "On track" display

**File:** `web/components/body-comp-chart.tsx`

Change status text from:
```
On track · Jun 1
```
To:
```
On track · Jun 1 (77 days)
```

Use `profile.daysRemaining` already in the API response.

**Commit:** `fix(trajectory): add days remaining to on-track status`

---

### Task 11: On-track corridor (±1kg green band)

**File:** `web/components/body-comp-chart.tsx`

Add a shaded green area around the projection line on the weight chart showing ±1kg tolerance.

Use Recharts `<Area>` component with two data series: `projectedHigh` (projected + 1) and `projectedLow` (projected - 1).

**File:** `web/app/api/nutrition/body-comp/route.ts`

Add `projectedHigh` and `projectedLow` to each projection data point:
```ts
projection.push({
  date: dateStr,
  weight: Math.round(projWeight * 10) / 10,
  weightHigh: Math.round((projWeight + 1) * 10) / 10,
  weightLow: Math.round((projWeight - 1) * 10) / 10,
  bf: Math.round(projBf * 10) / 10,
});
```

In the chart, add an Area between high and low:
```tsx
<Area type="monotone" dataKey="projHigh" stroke="none" fill="#22c55e" fillOpacity={0.08} />
<Area type="monotone" dataKey="projLow" stroke="none" fill="transparent" />
```

Actually, Recharts doesn't have a built-in "band" component. Simplest approach: use two reference areas or a custom area. The simplest: just add `<ReferenceArea>` strips along the projection, but that's complex with dynamic data.

Alternative: use a single `<Area>` with the projection data, set fillOpacity very low (0.05-0.08), strokeWidth 0. This creates a subtle shading under the projection line, giving a visual corridor effect.

**Commit:** `feat(trajectory): add on-track corridor band around weight projection`

---

### Task 12: Handle past target dates gracefully

**File:** `web/app/api/nutrition/body-comp/route.ts`

Add explicit check:
```ts
const targetDatePassed = new Date(targetDate) < new Date(today);
```

When past:
- Set `onTrack: false`
- Set a readable status like `"targetPassed"` instead of computing absurd deficit
- Don't compute `requiredDeficit` (or set to null)

**File:** `web/components/body-comp-chart.tsx`

When `profile.targetPassed`:
```tsx
<span className="text-rose-500 font-medium">Target date passed · adjust goal</span>
```

**Commit:** `fix(trajectory): handle past target dates gracefully instead of absurd deficit numbers`

---

## Summary

| # | Fix | Files |
|---|-----|-------|
| 1 | CSS color bug (invisible chart) | chart.tsx |
| 2 | X-axis ticks + Y-axis labels + kg unit | chart.tsx |
| 3 | Taller charts | chart.tsx |
| 4 | Status: actual weight + days + rate | chart.tsx, route.ts |
| 5 | Bridge projection gap | route.ts |
| 6 | Different projection vs target colors | (in Task 1) |
| 7 | Mobile status wrapping | chart.tsx |
| 8 | cal → kcal | chart.tsx |
| 9 | Inline legend | chart.tsx |
| 10 | "On track (77 days)" context | chart.tsx |
| 11 | On-track corridor band | chart.tsx, route.ts |
| 12 | Past target date handling | chart.tsx, route.ts |
