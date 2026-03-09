# Training Intelligence — Research & Implementation Log

**Created**: 2026-03-08
**Purpose**: Track every decision, finding, and change as we transform the training page from disconnected graphs into a live formula visualizer.

**Detailed gap analysis files** (written by 5 independent subagents):
- `gaps-trajectory-model-viz.md` — TF Playground comparison, activation, animation, parameters
- `gaps-reference-metrics.md` — Reference panel shows wrong data (0/6 design cards implemented)
- `gaps-workout-detail.md` — P0 field name mismatch, workout steps render EMPTY
- `gaps-exhaustive-reread.md` — Line-by-line check: 12 critical, 14 partial, 10 implemented
- `gaps-page-layout.md` — Layout order wrong, graph/trajectory disconnected, slider buried

---

## 1. Source Documents

| Document | Purpose |
|----------|---------|
| `docs/plans/2026-03-07-adaptive-coach-design.md` | Original vision: transparent adaptive training system |
| `docs/plans/2026-03-08-training-intelligence-ui-design.md` | UI design: computation graph, trajectory, delta simulator, explainability |
| `docs/plans/2026-03-08-training-intelligence-ui-impl.md` | Implementation plan: 12 tasks with dependency graph |
| `docs/race-prep-hm/research/SYNTHESIS-PHASE-A.md` | Training load metrics, readiness signals, race prediction |
| `docs/race-prep-hm/research/SYNTHESIS-PHASE-B.md` | Combination weights (Dawes 1979), strength load, individualization |
| `docs/race-prep-hm/research/SYNTHESIS-PHASE-B-FINAL.md` | Architecture (parallel streams), data audit, PMC initialization |
| `docs/race-prep-hm/research/SYNTHESIS-PHASE-C.md` | HM-specific: periodization, nutrition, taper, pacing, 5-week plan |

---

## 2. User Requirements (Verbatim Quotes → Mapped to Features)

| # | User Quote | Required Feature |
|---|-----------|-----------------|
| U1 | "Not just display random graphs I dont know how to use. No hover info currently no explanations no interactiveness." | Universal hover explainability + interactive elements |
| U2 | "Up at the top needs to be the things I will be looking at most frequently" | Page layout reordering by usage priority |
| U3 | "The main component is the trajectories. But how we envisioned them, basically a formula visualizer. Exactly like in the plan files." | Trajectory = output of visible computation graph |
| U4 | "The formulas should be visually encoded in the trajectories. I want 100% explainability. I want to be seeing what gets calculated and how visually through the trajectories." | Bidirectional link: trajectory ↔ computation graph |
| U5 | "Imagine the formula visualizer like a neural network live visualizer similar to tensorflow playground" | Left-to-right DAG with flowing data, neuron activation |
| U6 | "Slider should change the trajectories and if the computation is fast enough it should also change all the other graphs" | Slider ripple to ALL page elements |
| U7 | "gradient of colors from red to green for each line on the graph. So when I use the slider and see what becomes red I know which aspects of my training/body status are going to be more strained" | Per-segment color gradient + MULTI-DIMENSIONAL trajectories |
| U8 | "When we apply delta we dont want to change the actual curve, but want to create a shadow of the actual one instead" | Shadow curve (not modifying actual) |
| U9 | "all the values that change and all the external metrics that change and all the runs that change, are yellow semi-transparent" | Yellow overlays on ALL changed elements |
| U10 | "the user might not know what each formula/metric is. we need full hover explainability" | Two-tier tooltips everywhere (not just graph nodes) |
| U11 | "It should show if garmin is updated, it should also show previous runs greyed out and match them with garmin activities" | Past day styling + Garmin sync status |
| U12 | "all the workouts should show as detailed garmin workout plans with hr constraints loops etc. like we show them in the spotify playlist page" | Rich structured workout visualization (block layout, repeat groups) |
| U13 | "i should be able to edit the constraints if i want too. maybe i want to add a pace constraint on the cooldown manually" | Editable workout step constraints + add new constraints |
| U14 | "Interactive formula breakdown on click per trajectory point" | Click trajectory → see formula chain |
| U15 | "how do I know the model we are using? all the parameters of the model how they activate?" | Model identification + parameter visibility |
| U16 | "is it literally like tensorflow playground where you see the individual neurons how much they activate to make a decision?" | Per-node activation intensity visualization |
| U17 | "where are the alternative graphs that should be below the trajectory?" | External comparison metrics (Garmin vs ours) |
| U18 | "where is the viewing information of the run including the warmup the strides, the goals per segment (hr/pace) etc?" | Detailed workout step display with all targets |

---

## 3. The Fundamental Problem

**The page shows ZERO about the model. It is NOT "partially like TF Playground" — it is NOTHING like it.**

TF Playground's entire value is that you SEE:
1. What model architecture you're using (visible label)
2. What inputs go in (visible input nodes with values)
3. What weights/parameters the model has (visible, adjustable)
4. How each neuron activates (color intensity ∝ activation magnitude)
5. How data flows through layers (animated connections)
6. The output as a CONSEQUENCE of all the above (decision boundary)

**Our page shows: a line chart. Period.** No model name. No parameters. No weights. No activation. No flow. Just the output with no way to understand HOW it was produced.

**The user's key insight: "One model per trajectory."** Each trajectory line should represent a specific model/formula, and the model's internals should be AUTOMATICALLY APPARENT when looking at that trajectory. The trajectory IS the model visualization. When you look at the fitness trajectory, you should immediately see:
- What model produces it (e.g., "Banister Impulse-Response")
- What parameters it uses (tau1=42d, tau2=7d, k1=0.05, k2=0.08)
- What inputs feed it (daily EPOC loads, colored by magnitude)
- How those inputs activate each component (fitness accumulation vs fatigue decay)
- What the output means (your predicted performance potential)

Same for readiness trajectory, weight trajectory, etc. — each is a different model with different parameters, and ALL should be transparent.

### Three layers of failure:

1. **Model identity is invisible.** The user literally asked "how do I know the model we are using?" There is no model name, no architecture description, no parameter display anywhere on the page.

2. **The computation graph has zero parameters.** It shows today's snapshot values in boxes but doesn't show the MODEL — the functions, the weights, the response curves, the time constants. A node showing "CTL: 42.3" tells you nothing about HOW 42.3 was computed (EWMA with tau=42 days over daily EPOC loads).

3. **Critical data doesn't render.** Workout steps are BROKEN due to a field name mismatch (P0 bug). Sparklines are all empty arrays. Reference panel shows wrong metrics entirely.

---

## 4. Complete Gap Analysis (38 Gaps Total)

### 4.0 P0 — BROKEN (Must Fix First)

| # | Gap | Details | Impact |
|---|-----|---------|--------|
| **B1** | **Workout step field name mismatch** | Python stores `step_type`, `target_pace_min`, `target_pace_max`, `duration_type`, `duration_value`, `description`. TypeScript expects `type`, `target_pace_low`, `target_pace_high`, `distance_meters`, `duration_minutes`, `name`. NO adapter exists. Every step field reads as `undefined`. | Steps render as empty gray rows. Completion scoring inflated (pace always 100%). Plan-vs-actual comparison broken. |
| **B2** | **Reference panel shows WRONG metrics** | `buildReferenceMetrics()` extracts CTL, ATL, TSB, VDOT, readiness_factor, fatigue_factor — all already visible in the computation graph. **0 of 6 design-doc cards implemented.** | Panel is 100% redundant. No external comparison exists anywhere. |

### 4.1 Critical — Model Visibility (TF Playground Core)

| # | Gap | User Ref | Current State |
|---|-----|----------|---------------|
| **C1** | **Trajectory ↔ graph hover link is dead code** | U4, U14 | `hoveredDate` written but never read by computation graph. `/api/training/breakdown` endpoint EXISTS but never called. |
| **C2** | **No model identification** | U15 | Model is Banister IR + Composite Readiness + Daniels VDOT. NEVER stated anywhere on the page. |
| **C3** | **Model parameters invisible** | U15 | tau1=42, tau2=7, k1, k2, p0 stored in DB (`banister_params` table). No API endpoint. No UI. Calibration phase/weights fetched by API but never rendered. S-curve steepness=8, midpoint=0.4 hardcoded server-side, never shown. |
| **C4** | **No neuron activation intensity** | U16 | Nodes use 15% fill opacity — all look similar. TF Playground uses solid color scaled by activation magnitude. Weak signal looks same as strong signal. |
| **C5** | **No contribution decomposition** | U16 | Cannot answer "which signals pull pace UP vs DOWN today?" No waterfall, no force diagram, no up/down arrows on edges. |
| **C6** | **No animation or flow** | U5 | Zero animation anywhere. Static SVG. No particles on edges, no cascade timing, no transition animations on value changes. |
| **C7** | **No response curve visualization** | U4 | Merge nodes don't show WHERE on the transfer function you are. E.g., readiness_factor=1.02 but no mini-chart showing the z-score → factor mapping with "you are here" dot. |

### 4.2 Critical — Trajectory & Visualization

| # | Gap | User Ref | Current State |
|---|-----|----------|---------------|
| **C8** | **Only one trajectory dimension (VDOT)** | U7 | "Which aspects of my training are strained" implies multiple lines (fitness, fatigue, readiness, weight). Currently only VDOT shown. |
| **C9** | **Per-segment gradient missing** | U7 | Lines are single-color. Only dots have gap-based coloring. |
| **C10** | **Formulas not visually encoded in trajectory** | U4 | S-curve parameters, taper region, formula invisible. User can't see HOW the optimal curve was computed. |
| **C11** | **No future projection line** | Design §2.3 | Actual VDOT stops at latest data. No dotted projection to race day showing "if you continue like this..." |
| **C12** | **Slider only propagates to 2 of 20+ nodes** | U6 | `computeShadowGraph()` updates slider_factor and adjusted_pace only. CTL, ATL, TSB, z-scores all unchanged. |

### 4.3 Critical — Reference Panel & Comparison

| # | Gap | User Ref | Current State |
|---|-----|----------|---------------|
| **C13** | **No Garmin Training Readiness comparison** | U17 | Data exists in DB (garmin_readiness_score). Never surfaced. |
| **C14** | **No Garmin Race Predictions comparison** | U17 | May not be in raw data lake yet. |
| **C15** | **No Strength Load breakdown** | U17 | PMC doesn't tag loads by source (running vs Hevy). |
| **C16** | **No Pace-HR Decoupling card** | U17 | Data exists in fitness_trajectory table. Not wired to panel. |
| **C17** | **No Efficiency Factor trend** | U17 | Data exists. Discarded by graph API. |
| **C18** | **No Weight Trend with race context** | U17 | No "1kg = ~1:00 HM" label. Weight is in graph but without race framing. |
| **C19** | **All sparklines empty** | Design §2.4 | Every metric passes `sparkline: []`. No history queries exist. |
| **C20** | **Comparison rows never populated** | U17 | `comparison?: { ours, garmin }` field defined but always null. |
| **C21** | **No section header on reference panel** | Design §2.4 | No label explaining these are external signals, not model nodes. |

### 4.4 Significant — Page Layout

| # | Gap | Details |
|---|-----|---------|
| **L1** | **Race info pushes graph down ~200px** | RaceCountdown + RaceSplitsCard sit above graph. Design doc: graph IS the first thing. |
| **L2** | **Graph and trajectory visually disconnected** | Graph = bare div. Trajectory = Card wrapper. 24px gap. Design doc: "directly below and visually connected." |
| **L3** | **Slider buried and too small** | 1.5px height `<input type="range">` with 10px labels. Below the full graph SVG. Design doc: "the delta simulator" that drives everything. |
| **L4** | **Override alerts inside graph, not at page top** | Design doc: "impossible to miss." Currently buried after race info. |
| **L5** | **Page feels like disconnected widgets** | Uniform 24px spacing. No section headings. Inconsistent containers. No visual flow. |

### 4.5 Significant — Workout Detail

| # | Gap | Details |
|---|-----|---------|
| **W1** | **No visual block layout** | Design doc: "Each step as a block." Current: minimal 10px text rows with 2px borders. Playlist page has rich card-based segments. |
| **W2** | **Editing disabled** | `editable` prop never set to true. Full InlineEdit infrastructure exists as dead code. |
| **W3** | **No repeat group structure** | 5x1000m shows as 9 flat rows. No "5x repeat" grouping. Playlist page wraps repeats. |
| **W4** | **No HR zone targets in plan data** | plan_generator only sets pace targets, never HR zones. |
| **W5** | **No per-segment actual vs planned** | Side panel shows aggregate stats only, no lap-by-lap comparison. |
| **W6** | **No Strava link in side panel** | Only Garmin Connect link. User asked for both. |
| **W7** | **Completion score HR always 100%** | HR compliance hardcoded, not actually compared to constraints. |
| **W8** | **Score breakdown bars are fake** | `(score - 20) * 1.25` reverse-engineered, not independently computed. |

### 4.6 Moderate — Explainability & Polish

| # | Gap | Details |
|---|-----|---------|
| **E1** | **Trajectory chart lacks formula explanations** | No tooltip on axes explaining VDOT, no explanation of S-curve formula, no taper region annotation. |
| **E2** | **Training plan lacks hover explanations** | Run types, distances, completion methodology unexplained. |
| **E3** | **No "you are here" emphasis** | Today marker is subtle dashed line with 9px label. No prominent callout with gap value. |
| **E4** | **No Garmin data sync status** | When was data last pulled? No indicator. |
| **E5** | **Calibration info fetched but never displayed** | API returns phase, dataDays, weights, forceEqual. Never rendered. |
| **E6** | **Delta doesn't update per-step pace/HR** | Slider changes day-level distance/type but not step-level targets. |
| **E7** | **Paces card hardcoded to VDOT 47** | Should be dynamic from current VDOT. |

---

## 5. Severity Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **P0 BROKEN** | 2 | Workout steps render empty. Reference panel shows wrong data. |
| **Critical** | 21 | Model invisible, no activation viz, dead hover link, single trajectory, no comparisons |
| **Significant — Layout** | 5 | Race info pushes graph down, graph/trajectory disconnected, slider buried |
| **Significant — Workout** | 8 | No block layout, editing disabled, no repeat groups, no HR zones, no Strava link, fake scores |
| **Moderate** | 7 | Explainability, polish, dynamic paces |
| **Total** | **43** | |

---

## 6. Priority Implementation Order

### Phase 0 — Fix What's Broken (prerequisite for everything)

1. **B1**: Add `normalizeSteps()` adapter for workout field name mismatch
2. **B2**: Rewrite `buildReferenceMetrics()` with correct external metrics

### Phase 1 — Make It a Formula Visualizer (the core transformation)

3. **C1**: Wire `hoveredDate` → computation graph update (the KEY feature)
4. **C2 + C3**: Add Model Parameters panel (Banister params, calibration state, weights)
5. **C4**: Increase node activation intensity (fill opacity 15% → 40-60% scaled by magnitude)
6. **C5**: Add contribution decomposition (waterfall on output node click)
7. **C7**: Add response curve mini-charts in merge node deep tooltips

### Phase 2 — Trajectory Overhaul

8. **C8**: Add multi-dimensional trajectory (separate lines for fitness/fatigue/readiness)
9. **C9**: Per-segment color gradient on trajectory lines
10. **C10**: Annotate trajectory with formula regions (taper zone, S-curve inflection)
11. **C11**: Add future projection dotted line
12. **E3**: Prominent "you are here" marker with gap value

### Phase 3 — Reference Panel Rebuild

13. **C13-C18**: Implement all 6 design-doc reference cards
14. **C19**: Populate sparklines with 7-14 day history data
15. **C20**: Populate comparison rows (ours vs Garmin)
16. **C21**: Add section header explaining these are external comparison signals

### Phase 4 — Layout & Structure

17. **L1**: Condense race info into header bar; move full cards below plan
18. **L2**: Wrap graph + trajectory in single shared container
19. **L3**: Redesign slider (bigger, color-coded, prominent)
20. **L4**: Move override alerts to page top / sticky banner
21. **L5**: Add section headings, vary spacing, consistent containers

### Phase 5 — Workout Detail Overhaul

22. **W1**: Port visual block layout from playlist page
23. **W2**: Enable editing (`editable={true}`) + wire save handler
24. **W3**: Add repeat group structure (detect and collapse)
25. **W4**: Add HR zone targets to plan generator
26. **W5-W8**: Per-segment comparison, Strava link, fix scoring

### Phase 6 — Animation & Polish

27. **C6**: Edge particle animation + cascade timing + node transitions
28. **C12**: Full slider propagation through all graph nodes
29. **E1-E7**: Remaining explainability and polish items

---

## 7. Running Log

### Entry 1 — 2026-03-08 (Initial): Read source docs, basic exploration

**Action**: Read all 8 source documents + explored current codebase with 1 subagent.

**Initial assessment**: Backend ~95% complete. Frontend has components but needs 3 interaction fixes (hover link, gradient, slider ripple). Identified 7 gaps.

**Problem**: Missed the forest for the trees. Focused on what EXISTS and underweighted what's FUNDAMENTALLY WRONG.

### Entry 2 — 2026-03-08 (Deep Dive): 5 parallel subagents with sequential thinking

**Action**: Dispatched 5 specialized subagents to independently analyze:
1. Trajectory as model visualizer (TF Playground comparison)
2. Reference panel / alternative metrics
3. Workout detail visualization
4. Exhaustive line-by-line requirement re-read
5. Page layout and flow

**Devastating findings**:

**P0 BUG — Workout steps are COMPLETELY BROKEN**: Python backend stores `step_type`, `target_pace_min`, `target_pace_max`. TypeScript frontend expects `type`, `target_pace_low`, `target_pace_high`. No adapter exists. Every workout step field reads as `undefined`. Steps render as empty gray rows. This also breaks completion scoring (pace score always 100%) and plan-vs-actual comparison (pace row never renders).

**Reference panel is 100% wrong**: Shows CTL, ATL, TSB, VDOT, readiness_factor, fatigue_factor — ALL already visible in the computation graph above. 0 of 6 design-doc external comparison cards implemented. Sparklines are all empty arrays `[]`. Comparison rows never populated.

**Model is invisible**: No model name displayed. No parameters shown. Banister params (tau1/tau2/k1/k2) stored in DB but no API endpoint, no UI. Calibration state fetched but never rendered. S-curve formula hardcoded server-side, never shown.

**It's NOT like TF Playground**: Current is a static labeled diagram. TF Playground has: activation intensity (neuron color ∝ magnitude), animated data flow, contribution decomposition (up/down forces), response curves in neurons, real-time input manipulation. We have: 15% opacity fill (all nodes look same), zero animation, no contribution arrows, no response curves, slider changes 2/20+ nodes.

**Page layout is wrong**: Race countdown pushes graph down 200px. Graph and trajectory visually disconnected. Slider is 1.5px tall with 10px labels, buried below the fold. Override alerts inside graph component instead of page top.

**Total gap count**: 38 (was 7 in initial analysis).

**Decision**: Complete rewrite of gap analysis. Prioritized into 6 implementation phases. Phase 0 (fix broken things) must come first before any feature work.

### Entry 3 — 2026-03-08 (Implementation): 18-task UI overhaul executed

**Action**: Executed 18-task plan via subagent-driven development. All tasks committed (19 commits from `00ec70c` to `b1e543e`).

**What was built**:
- `normalize-steps.ts` — Adapter fixing P0 field name mismatch (B1)
- `model-params-panel.tsx` — Model name, Banister params, calibration state, weight bars (C2+C3)
- `pace-waterfall.tsx` — Horizontal waterfall showing per-factor pace contribution (C5)
- `response-curve.tsx` — SVG mini-charts showing transfer functions with "you are here" dot (C7)
- `training-paces-card.tsx` — Full Daniels/Gilbert VO2 equations ported to TypeScript (E7)
- Trajectory chart overhaul — multi-dimensional lines, per-segment gradient, taper annotation, future projection, "you are here" marker (C8-C12, E3)
- Computation graph overhaul — directional edge colors, particle animation, cascade timing, slider propagation to 6 nodes (C4, C6, C12)
- Reference panel rewrite — external comparison signals, not model-internal metrics (B2, C13-C21)
- Workout step editor — visual block layout, repeat groups, colored step types, inline editing (W1-W3)

**Gaps closed**: 33 of 43 (B1-B2, C1-C21, L1-L5, W1-W3, E1, E3, E5-E7)
**Gaps remaining**: 5 (W4-W6, E2, E4) + 5 newly identified below

### Entry 4 — 2026-03-08 (Audit): Full intent-vs-reality investigation

**Action**: User questioned whether the trajectory computation is actually understood. Dispatched 2 parallel subagents to exhaustively audit all docs from 2026-03-07 onwards and trace implementation drift in code.

**Devastating finding: The system is a snapshot engine, not a projection engine.**

The design doc (§3, §4) envisioned a forward-simulating adaptive training system. What was built is a static plan generator + daily snapshot merge. The trajectory is decorative, not computed from the model.

---

## 8. Complete Intent vs Reality Audit

### 8.1 The Training Plan

| Aspect | Design Intent (§3 "What ADAPTS") | Reality |
|--------|----------------------------------|---------|
| **Workout types** | Adapt based on readiness/fatigue | Hardcoded 5-week template |
| **Distances** | ±10-15% based on signals | Fixed per day, never changes |
| **Rest days** | Insert based on readiness markers | Fixed: Wed in weeks 1-3, Sun week 4, Fri week 5 |
| **Run type swaps** | "tempo → easy if fatigued" | Only `todayAdaptation` on frontend (crude, not research-based) |
| **VDOT usage** | Determines pace AND adapts plan structure | Determines pace only. Distances/types/rest all hardcoded |

### 8.2 Adjustment Factors

| Factor | Design Intent (§3 Layer 3) | Reality |
|--------|---------------------------|---------|
| `sleep_factor` | From HRV, sleep score, body battery | Collapsed into `readiness_factor` (4-signal z-score composite) |
| `fatigue_factor` | From ACWR, training load | From TSB only (PMC). ✓ Working |
| `nutrition_factor` | User-reported | Never built |
| `illness_factor` | User-reported | Never built |
| `substance_factor` | Alcohol/cannabis (research: alcohol→substance_factor=0.7) | Never built |
| `stress_factor` | From Garmin stress, user-reported | Garmin stress extracted but removed from composite, reference panel only |
| `motivation_factor` | User slider | Implemented as `slider_factor` ✓ |
| `schedule_factor` | User-reported ("moving run to tomorrow") | Never built |

**8 intended → 3 built** (readiness, fatigue, weight) + 1 slider

### 8.3 Calibration & Individualization

| Phase | Design (Phase B §10.2) | Reality |
|-------|----------------------|---------|
| Phase 1: Equal weights (Day 0-30) | Dawes 1979 — optimal for noisy correlated predictors | ✓ Implemented. **Used indefinitely** |
| Phase 2: Personal correlation (Day 30-60) | Within-individual Pearson r between signals and session quality | Code exists in `calibration.py` but **never called** |
| Phase 3: LASSO regression (Day 60+) | Elastic net on personal data | Code exists but **never called** |
| Phase 4: Kalman filter (ongoing) | Continuous adaptation (Kolossa 2017) | Placeholder only, logs "not yet implemented" |
| Banister fitting | Bayesian MCMC on 465 runs, personal τ1/τ2 | Full optimizer in `banister.py` but **never called** |

### 8.4 Dead Code Inventory

| File | Function | What it would do | Why it's dead |
|------|----------|-----------------|---------------|
| `banister.py` | `fit_from_db()` | Personalize τ1=42/τ2=7 from your run history | `runner.py` never calls it |
| `calibration.py` | `advance_calibration()` | Progress from equal weights to personal weights | `runner.py` never calls it |
| `sequencing.py` | `check_leg_day_conflict()` | Enforce 48h gap between heavy legs and quality runs | Nothing calls it |
| `fitness_stream.py` | Decoupling thresholds | Flag aerobic readiness (<3% excellent, <5% adequate) | Computed but never triggers any action |

### 8.5 Data Used vs Available

| Data Source | Available in DB | Used by Model | Used in UI |
|-------------|----------------|---------------|------------|
| HRV (overnight avg) | ✓ `daily_health_summary` | ✓ readiness z-score | ✓ computation graph |
| Sleep (total hours) | ✓ `daily_health_summary` | ✓ readiness z-score | ✓ computation graph |
| Resting HR | ✓ `daily_health_summary` | ✓ readiness z-score | ✓ computation graph |
| Body Battery (wake) | ✓ `daily_health_summary` | ✓ readiness z-score | ✓ computation graph |
| Garmin Stress | ✓ `daily_health_summary` | ✗ removed from composite | ✗ reference panel only |
| Garmin Training Readiness | ✓ `daily_health_summary` | ✗ unused | ✓ reference card (comparison) |
| Sleep deep%/REM%/efficiency | ✓ `sleep_detail` | ✗ uses composite only | ✗ not shown |
| Pace-HR decoupling | ✓ `fitness_trajectory` | ✗ computed but not actioned | ✓ reference card |
| Efficiency Factor | ✓ `fitness_trajectory` | ✗ computed but not actioned | ✓ reference card |
| Weight (7d EMA) | ✓ `fitness_trajectory` | ✓ VDOT adjustment | ✓ computation graph |
| Strength load (Hevy) | ✓ `training_load` | ✓ feeds PMC (0.5× cross-modal) | ✗ no breakdown in UI |
| Run history (465 runs) | ✓ `garmin_activity_raw` | ✗ available for Banister fitting, never used | ✗ |
| Garmin VO2max per run | ✓ `garmin_activity_raw` | ✓ fitness trajectory Y-axis | ✓ trajectory chart |
| Garmin race predictions | ? may not be extracted | ✗ | ✗ |
| Garmin acute/chronic load | ✓ `daily_health_summary` | ✗ we compute our own PMC | ✗ could compare |
| Elevation/grade data | ✓ per-activity | ✗ no grade-adjusted pace | ✗ |

### 8.6 todayAdaptation — NOT Research-Based

Frontend `page.tsx:274-298` uses made-up values:

| Condition | Applied Value | Research Basis |
|-----------|--------------|----------------|
| RED + hard workout → easy 4km | `paceFactor: 1.10` | **None.** merge.py says z≤-2 → REST, not 10% slower |
| RED + easy workout → reduce | `0.85 × distance` | **None.** Design doc says "±10-15%" without citation |
| YELLOW + hard → easy | `0.85 × distance, paceFactor: 1.05` | **Loosely matches** merge.py z≤-1→1.05 |
| TSB < -20 → reduce | `0.85 × distance, paceFactor: 1.03` | **Matches** merge.py TSB≤-20→1.03 |
| TSB < -15 → reduce | `0.90 × distance, paceFactor: 1.02` | **Interpolation** from merge.py, reasonable |

These should be replaced by calling the actual merge formula instead of duplicating/approximating it.

### 8.7 Forward Simulation — The Core Missing Piece

**Design doc §4 "Delta Simulator"**:
> "Drag slider, trajectory redraws in real time. Shows physical meaning of the delta (pace change, projected HR, zone). Shows risk level based on recovery markers."

> "This moves your tempo from 5:10 → 5:02/km, projected HR ~172"

**What this requires**:
1. Take today's model state (CTL, ATL, TSB, readiness signals)
2. For each future plan day:
   a. Compute that day's training load from planned workout (distance × estimated HR)
   b. Propagate PMC forward: `CTL_new = load × α_42 + CTL_prev × (1-α_42)`
   c. Compute projected TSB = CTL - ATL
   d. Estimate readiness (decay toward baseline if no data)
   e. Apply merge formula → get that day's adjusted pace/type/distance
   f. Determine if rest is needed (z ≤ -2 → REST signal)
3. When slider changes, re-run the simulation with scaled loads
4. Show shadow trajectory vs actual trajectory

**What exists**: Slider adjusts TODAY's graph only. No day-by-day propagation. Trajectory is decorative S-curve.

### 8.8 Timeline of Drift

```
Mar 7 AM   Design Doc         Full vision: 8 factors, Banister, Kalman, adaptive
                               plan, forward simulation, per-workout projection,
                               Garmin comparison plots, Claude coach interface

Mar 7 PM   Impl Plan          Scoped down: "static 5-week structure" (line 7).
                               Banister = backlog. Calibration = scaffolding.
                               Coach interface = explicitly deferred.

Mar 7-8    Backend Build       17 tasks. Streams + merge + plan gen + dashboard.
                               Clean architecture, correct formulas. But: no plan
                               adaptation, no forward sim, no calibration wiring.

Mar 8      UI Overhaul         18-task plan: trajectory, hover, waterfall, response
                               curves, animation. Added viz layer on top of snapshot
                               engine. Still no forward projection.

Mar 8      Audit (this entry)  Discovered: the whole system computes TODAY only.
                               Plan is static. Trajectory is cosmetic. Dead code
                               exists for Banister/calibration/sequencing but
                               nothing calls it. todayAdaptation is made-up values.
```

---
