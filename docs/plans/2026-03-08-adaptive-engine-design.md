# Adaptive Training Engine — Full Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the training page from a static plan + daily snapshot into a forward-simulating adaptive engine where every workout target is computed from the model, every adaptation is science-based, and the full computation chain is visible.

**Architecture:** Client-side forward simulation seeded by server-side state. Banister model with personal τ1/τ2 feeds PMC. Load-reactive readiness projection. Merge formula drives all pace/distance/HR adaptation. Automatic session quality feedback enables calibration advancement.

**Tech Stack:** Python 3.10+ (Banister fitting, calibration, pipeline), TypeScript (forward simulation, computation graph, trajectory), Recharts (charts), Neon PostgreSQL.

---

## 1. Forward Simulation Engine (Client-Side TypeScript)

### Inputs (fetched once from server)
- Current PMC state: today's CTL, ATL, TSB
- Current readiness: today's composite z-score
- Banister params: personal p0, k1, k2, τ1, τ2
- Calibration weights: equal or personal (user toggle)
- Remaining plan days: run_type, target_distance_km, workout_steps, load_level, gym_workout
- Current weight-adjusted VDOT
- Slider multiplier (default 1.0)

### Per-Day Forward Loop

For each remaining plan day D:

1. **Estimate training load** from planned workout:
   ```
   load = distance_km × pace_factor × intensity_multiplier
   ```
   Where intensity_multiplier from run_type: easy=0.6, tempo=1.0, intervals=1.2, long=0.8, rest=0.
   Gym load added if gym day (from strength_load estimation or historical average).
   Slider multiplies all loads.

2. **Propagate PMC** with personal time constants:
   ```
   α_ctl = 1 - exp(-1/τ1)    // personal τ1 from Banister fitting
   α_atl = 1 - exp(-1/τ2)    // personal τ2 from Banister fitting
   CTL_D = load × α_ctl + CTL_(D-1) × (1 - α_ctl)
   ATL_D = load × α_atl + ATL_(D-1) × (1 - α_atl)
   TSB_D = CTL_D - ATL_D
   ```

3. **Project readiness** (load-reactive model):
   - Hard session: z drops by `min(load/200, 1.0)`
   - Rest day: z recovers by 0.4/day toward 0
   - Easy day: z recovers by 0.2/day toward 0
   - Sequencing conflict (leg day within 48h of hard run): additional z drop of 0.3

4. **Apply merge formula** (all research-based):
   ```
   readiness_factor = f(projected_z)      // Nuuttila 2021, Plews 2013
   fatigue_factor = f(projected_TSB)      // Banister 1975
   weight_factor = calibration_weight / current_weight  // Daniels 2014
   combined = readiness_factor × fatigue_factor × weight_factor
   adjusted_pace = base_pace × combined
   ```

5. **Scale workout targets** from merge output:
   - Pace: directly from adjusted_pace (proportional scaling of all step targets)
   - Distance: `adjusted_distance = base_distance × (2.0 - combined_factor)` — preserves intended training load (load ≈ distance × intensity)
   - HR zones: derived from adjusted pace via Daniels VO2 cost equation (faster pace → higher O2 demand → higher HR)
   - No arbitrary percentages — everything flows from the merge formula

6. **Predict VDOT** via Banister model:
   ```
   p(t) = p0 + k1 × Σ(load_i × exp(-(t-i)/τ1)) - k2 × Σ(load_i × exp(-(t-i)/τ2))
   ```

### Output

Array of `ProjectedDay` objects, each containing:
- Full computation graph state (all node values for that day)
- Adjusted pace, distance, HR zones
- Projected VDOT
- Projected CTL, ATL, TSB
- Adaptation delta vs original plan

This array IS the trajectory data AND the source for hovering any future point.

### Slider Interaction

Slider multiplies all future loads → re-runs the loop → new projected array → trajectory + graph update instantly (client-side, no API).

---

## 2. Adaptation Visualization

### Per-Workout Target Display

All adaptations come from the merge formula. No arbitrary percentages.

- **No change**: Normal display (white text)
- **Adapted down** (combined > 1.0): Original value ~~strikethrough~~ dim, new value in red semi-transparent
- **Adapted up** (combined < 1.0): Original value ~~strikethrough~~ dim, new value in green semi-transparent
- Pace AND distance shown independently — you could get faster pace but shorter distance depending on factors

### Adaptation Direction

| Condition | Pace | Distance | HR Zones |
|-----------|------|----------|----------|
| Good readiness (z>0) + fresh (TSB>0) | Faster | Longer (preserves load) | Higher |
| Bad readiness (z<-1) + fatigued (TSB<-15) | Slower | Shorter (preserves load) | Lower |
| REST signal (z≤-2) | N/A — rest day | 0 | N/A |

All values computed by: merge formula → VO2 cost equation → zone derivation. Zero made-up numbers.

### On Trajectory Chart

- Each projected workout = dot, color = adaptation magnitude (green↔white↔red)
- Hover dot → computation graph shows that day's full projected state
- Click dot → side panel shows workout details with ~~original~~ → adapted treatment
- Shadow curve when slider ≠ 1.0 (yellow semi-transparent, unsaved state)

---

## 3. Banister Integration

### Fitting (Backend, Weekly)

`runner.py` calls `fit_from_db()` weekly (or when new anchor runs detected):
- Loads 465-run history from `garmin_activity_raw`
- Detects maximal-effort anchor runs (avg_hr ≥ 90% HRmax, distance ≥ 2km)
- Fits p0, k1, k2, τ1, τ2 via differential evolution (existing code in `banister.py`)
- Stores in `banister_params` table
- Fitted τ1/τ2 replace hardcoded 42/7 in ALL PMC computation

### Computation Graph Visibility

Banister internals become visible nodes in the Stream column:

```
Raw inputs          Stream (Banister visible)           Merge           Output
─────────           ─────────────────────────           ─────           ──────
EPOC loads ──→  Fitness accumulation [τ1=38d] ──→ CTL ─┐
                Fatigue accumulation [τ2=9d]  ──→ ATL ─┤→ TSB → fatigue_factor ─┐
                p0 (baseline VDOT=45.2)       ──→      │                        ├→ adjusted_pace
                                                        │                        │   projected_VDOT
HRV_raw → HRV_z ──┐                                    │                        │
Sleep_raw → Sleep_z ┼→ composite_z → readiness_factor ──┘                        │
RHR_raw → RHR_z ──┤                                                              │
BB_raw → BB_z ────┘                                                              │
                                                                                  │
Weight_raw → Weight_EMA ──────────→ weight_factor ───────────────────────────────┘
```

- τ1, τ2, k1, k2, p0 shown as parameter chips on Banister nodes
- Hover fitness accumulation node: "Your personal fitness decay: 38 days (population default: 42). Fitted from 12 anchor runs."
- All parameters visible like neural network weights in TF Playground

---

## 4. Calibration & Session Quality Feedback

### Wiring Calibration Phases

`runner.py` calls `advance_calibration(conn, today)` after readiness computation:

- Computes on ALL available historical data (including pre-plan 5K training period)
- Phase 1 (<30 signal-quality pairs): equal weights (Dawes 1979)
- Phase 2 (≥30 pairs): Pearson r between each signal and session quality, weights = |r| normalized
- Phase 3 (≥60 pairs): LASSO regression for robust weights

### Session Quality — Automatic from Garmin Sync

When a Garmin activity syncs and matches a plan day:

```python
pace_quality = planned_pace / actual_pace
  # >1.0 = ran faster than planned = good
hr_quality = planned_hr / actual_hr
  # >1.0 = lower HR than expected = good
session_quality = (pace_quality + hr_quality) / 2
```

Stored in `training_plan_day.session_quality_score`. Feeds calibration Phase 2 correlation analysis.

### UI: Weight Toggle

Model params panel gets a toggle: **Equal Weights ↔ Personal Weights**

- Toggling instantly recomputes forward simulation with different readiness weights
- Personal weights: signal bars show |r| values (e.g., "HRV: r=0.41, weight=0.35")
- Equal weights: flat bars (0.25 each) with "Dawes 1979" citation
- User can switch anytime

---

## 5. Comparison Charts

Below the main trajectory section, 4 comparison chart cards. Each shows our metric (solid, colored) vs Garmin's equivalent (dashed, gray).

| Chart | Our Metric | Garmin Equivalent |
|-------|-----------|-------------------|
| Training Load | PMC CTL/ATL (personal τ1/τ2) | Garmin 7-day / 28-day load |
| Readiness | Composite z-score (4-signal) | Training Readiness score (0-100) |
| Fitness | Banister-predicted VDOT | Garmin VO2max estimate |
| Race Prediction | Daniels time_from_vdot(21097.5m) | Garmin race prediction |

### Interaction
- Same time range as trajectory (plan start → race day)
- Hover syncs across all charts + trajectory (vertical crosshair)
- Slider affects our lines only (Garmin stays fixed — external ground truth)
- Each chart shows correlation badge: "r = 0.82"

---

## 6. Sequencing Enforcement

`check_leg_day_conflict()` called during forward simulation for each projected day:

- Hard run within 48h of leg/lower gym session → conflict flagged (Doma 2014, 2017)
- Conflict feeds INTO readiness as z penalty (−0.3) → flows through merge formula naturally
- No separate adaptation logic — sequencing is just another readiness input
- Workout card shows warning badge: "Legs yesterday — 48h rule"

---

## 7. Hevy Integration & Gym Day Cards

### Auto-Sync Pipeline

When Hevy workouts sync:
1. Match to plan day by date + gym_workout type
2. Compute strength load (Epley → Zourdos RPE → sRPE × duration × relevance × 0.5)
3. Store match + load in training_plan_day (hevy_workout_id, actual_gym_load, gym_completed)
4. Load feeds into PMC — next forward simulation incorporates it

### Gym Day Card Display

Each plan day with gym shows a gym section:

- **Planned**: Type badge ("Push — 14 sets"), muscle groups, expected load estimate
- **Completed**: Green check, actual exercises from Hevy (sets/weight/reps), computed load, duration
- **Hover**: Load breakdown — per-exercise RPE, running relevance factor, PMC contribution
- **Click**: Full Hevy workout detail
- **Sequencing warning**: Badge if legs/lower + hard run within 48h

### On Computation Graph

Day's EPOC raw node shows combined load: "Running: 142 + Strength: 84 (0.5× scaled) = total: 184"

---

## 8. Garmin Re-Push

When forward simulation produces adapted targets:

1. Plan days with changed pace/distance/HR → `garmin_push_status = 'pending'`
2. Next pipeline run (every 4h) picks up pending days
3. Builds new Garmin structured workout with updated targets
4. Pushes to Garmin Connect, schedules on date
5. Updates status to 'pushed'

UI: sync icon on workout card while pending, green checkmark after pushed.

---

## 9. Full Page Layout (Top to Bottom)

1. **Header bar** — Plan name, days to race, current week, calibration phase
2. **Override alerts** (sticky) — RED/YELLOW banners from hard override rules
3. **Computation Graph + Trajectory** (single card, main section)
   - Graph: Raw → Banister internals → Stream → Merge → Output (all parameters visible)
   - Slider: prominent, color-coded gradient
   - Trajectory: projected VDOT per workout, per-segment gradient, hover → graph updates
   - Model params: name, Banister params, calibration toggle, weight bars
4. **Comparison Charts** (4-card grid) — Our metrics vs Garmin, hover-synced
5. **Training Plan** (week-by-week)
   - Run section: block layout, repeat groups, ~~original~~ → adapted targets
   - Gym section: Hevy data, load, exercises, sequencing warnings
   - Past days greyed, Garmin activity matched, session quality score
   - Garmin sync status per workout
6. **Race Countdown + Splits** (bottom)

---

## 10. todayAdaptation Removal

The current `todayAdaptation` code in `page.tsx:274-298` with made-up values (85%, 3%, 10%) is REMOVED entirely. All adaptation comes from the forward simulation's merge formula output. No separate frontend logic — the simulation IS the adaptation.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Forward sim location | Client-side TypeScript | Instant slider feedback, no API round-trip |
| Readiness projection | Load-reactive (hard→z drops, rest→z recovers) | Useful signal without historical modeling complexity |
| Adaptation flow | Auto-compute, user adjusts with slider | Targets always reflect model; slider is the override |
| Banister integration | Personal τ1/τ2 replace PMC 42/7 + visible in graph | One change personalizes entire system |
| Calibration data | ALL historical data (including 5K prep) | Phase 2 can activate immediately |
| Weight toggle | Equal ↔ Personal, user choice | Transparency; user can compare both |
| Session quality | Automatic from Garmin (planned vs actual pace/HR) | Zero user effort |
| Missing factors (nutrition etc.) | Skip | Biometric signals catch most variance |
| Garmin comparison | Dedicated charts below, ours vs theirs | Clear separation, honest comparison |
| Sequencing | Feeds into readiness z-score penalty | No separate logic, flows through merge formula |
| Gym integration | Auto-match Hevy, full card display, load in PMC | First-class citizen, not text label |
| todayAdaptation | Removed, replaced by forward simulation | No more made-up values |
