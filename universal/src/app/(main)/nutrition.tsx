import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl, TextInput, Pressable } from "react-native";
import { Text, Card, Badge, SegmentedControl, ProgressBar, Button, Modal, Pill, PillGroup, Sparkline } from "soma-style";
import {
  useSomaPlan, usePresets, logPresetMeal, deleteMeal, quickAddMeal, skipSlot, useDrinks, logDrink, deleteDrink, closeDay,
  reopenDay, copyDay, setManualOverride,
  fetchJson, usePullRefresh, todayLocal, type Preset, type SomaMeal,
} from "../../lib/api";
import { BodyCompChart } from "../../components/body-comp-chart";
import { ActivitySelector } from "../../components/activity-selector";
import { ComposeMealView } from "../../components/compose-meal-view";
import { MealDetailModal } from "../../components/meal-detail-modal";
import { MacroGoalBar, buildMacroMarkers } from "../../components/macro-goal-bar";

/** 14-day daily-calories series for the adherence trend sparkline. */
function useCaloriesTrend() {
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    fetchJson<{ calories?: number[] }>("/api/overview/trends")
      .then((d) => alive && setSeries((d.calories ?? []).filter((v) => isFinite(v))))
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return series;
}

const MACROS: { key: string; label: string; color: string; tKey: string; ceiling?: number }[] = [
  { key: "protein", label: "Protein", color: "#b17850", tKey: "target_protein" },
  { key: "carbs", label: "Carbs", color: "#6366b0", tKey: "target_carbs" },
  { key: "fat", label: "Fat", color: "#cbe896", tKey: "target_fat" },
  { key: "fiber", label: "Fiber", color: "#82d0c8", tKey: "target_fiber", ceiling: 60 },
] as const;

const SLOT_ORDER = ["breakfast", "lunch", "during_workout", "dinner", "pre_sleep"];
const slotLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function mealName(m: SomaMeal): string {
  const names = (m.items ?? []).map((i) => i.name).filter(Boolean) as string[];
  if (names.length) return names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "");
  return m.source ? slotLabel(m.source) : "Meal";
}

function niceDate(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(y, (mo ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function shiftDate(iso: string, days: number): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(y, (mo ?? 1) - 1, (d ?? 1) + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export default function NutritionScreen() {
  const [DATE, setDATE] = useState(todayLocal());
  const isToday = DATE === todayLocal();
  const { data, loading, error, refetch } = useSomaPlan(DATE);
  // Reset per-day transient UI when the viewed day changes.
  useEffect(() => { setCloseStatus(null); setLogMode("preset"); setLogOpen(false); setEditMeal(null); setDetailMeal(null); }, [DATE]);
  const { refreshing, onRefresh } = usePullRefresh(refetch);
  const { presets, ingredients } = usePresets();
  const { drinks } = useDrinks();
  const [tab, setTab] = useState<"Day" | "Trend">("Day");
  const [logOpen, setLogOpen] = useState(false);
  const [slot, setSlot] = useState("lunch");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [delId, setDelId] = useState<number | null>(null);
  const [drinkOpen, setDrinkOpen] = useState(false);
  const [drinkBusy, setDrinkBusy] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeStatus, setCloseStatus] = useState<string | null>(null);
  const [logMode, setLogMode] = useState<"preset" | "quick" | "compose">("preset");
  const [qName, setQName] = useState("");
  const [qCal, setQCal] = useState("");
  const [qP, setQP] = useState("");
  const [qC, setQC] = useState("");
  const [qF, setQF] = useState("");
  const [qBusy, setQBusy] = useState(false);
  const [skipBusy, setSkipBusy] = useState<string | null>(null);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [delDrinkId, setDelDrinkId] = useState<number | null>(null);
  const [detailMeal, setDetailMeal] = useState<SomaMeal | null>(null);
  const [editMeal, setEditMeal] = useState<{ id: number; grams: Record<string, number> } | null>(null);

  const plan = data?.plan;
  const consumed = data?.consumed;
  const remaining = data?.remaining;
  const adaptive = data?.adaptive;
  const adherence = data?.trend7d?.adherence;
  const days = data?.trend7d?.days ?? [];
  const bd = data?.breakdown;
  const meals = data?.meals ?? [];
  const skippedSlots = data?.skippedSlots ?? [];
  const loggedDrinks = data?.drinks ?? [];
  const dayClosed = closeStatus === "closed" || plan?.status === "closed";
  const manualOverride = (bd?.manualOverride ?? false) && !dayClosed;
  const caloriesTrend = useCaloriesTrend();
  const targetCal = plan?.target_calories ?? 0;

  const availSlots = SLOT_ORDER.filter((s) => data?.slotBudgets?.[s] != null);
  const slots = availSlots.length ? availSlots : SLOT_ORDER.filter((s) => s !== "during_workout");
  // presets for the picker, ordered so the picked slot's meals surface first
  const pickerPresets = [...presets].sort((a, b) =>
    (a.meal_slot === slot ? 0 : 1) - (b.meal_slot === slot ? 0 : 1));

  async function onLog(preset: Preset) {
    setBusyId(preset.id);
    const ok = await logPresetMeal(DATE, slot, preset);
    setBusyId(null);
    if (ok) refetch();
  }
  async function onDetailDelete() {
    if (!detailMeal) return;
    setDelId(detailMeal.id);
    const ok = await deleteMeal(detailMeal.id);
    setDelId(null);
    if (ok) { setDetailMeal(null); refetch(); }
  }
  function onEditMeal(m: SomaMeal) {
    const g: Record<string, number> = {};
    for (const it of m.items ?? []) {
      if (it.ingredient_id && it.grams) g[it.ingredient_id] = Math.round(it.grams);
    }
    setEditMeal({ id: m.id, grams: g });
    setSlot(m.meal_slot);
    setLogMode("compose");
    setDetailMeal(null);
    setLogOpen(true);
  }
  async function onQuickAdd() {
    setQBusy(true);
    const ok = await quickAddMeal(DATE, slot, {
      name: qName.trim(),
      calories: Number(qCal) || 0,
      protein: Number(qP) || 0,
      carbs: Number(qC) || 0,
      fat: Number(qF) || 0,
    });
    setQBusy(false);
    if (ok) {
      setLogMode("preset");
      setQName(""); setQCal(""); setQP(""); setQC(""); setQF("");
      refetch();
    }
  }
  async function onSkip(s: string) {
    setSkipBusy(s);
    const ok = await skipSlot(DATE, s);
    setSkipBusy(null);
    if (ok) refetch();
  }
  async function onReopen() {
    setReopenBusy(true);
    const ok = await reopenDay(DATE);
    setReopenBusy(false);
    if (ok) { setCloseStatus(null); refetch(); }
  }
  async function onCopyYesterday() {
    setCopyBusy(true);
    const ok = await copyDay(shiftDate(DATE, -1), DATE);
    setCopyBusy(false);
    if (ok) refetch();
  }
  async function onUnlock() {
    setUnlockBusy(true);
    const ok = await setManualOverride(DATE, false);
    setUnlockBusy(false);
    if (ok) refetch();
  }
  async function onLogDrink(key: string) {
    setDrinkBusy(key);
    const ok = await logDrink(DATE, key);
    setDrinkBusy(null);
    if (ok) refetch();
  }
  async function onDeleteDrink(id: number) {
    setDelDrinkId(id);
    const ok = await deleteDrink(id);
    setDelDrinkId(null);
    if (ok) refetch();
  }
  async function onCloseDay() {
    setClosing(true);
    const status = await closeDay(DATE);
    setClosing(false);
    setCloseStatus(status);
    if (status) { setCloseOpen(false); refetch(); }
  }

  const burnRow = (label: string, value?: number, opts?: { amber?: boolean; bold?: boolean }) =>
    value == null ? null : (
      <View className="flex-row items-center justify-between py-1">
        <Text variant={opts?.bold ? "body" : "caption"} className={opts?.bold ? "text-text" : "text-text-secondary"}>{label}</Text>
        <Text variant={opts?.bold ? "body" : "caption"} className={`tabular-nums ${opts?.amber ? "text-warm" : opts?.bold ? "text-teal" : "text-text"}`}>
          {Math.round(value)} kcal
        </Text>
      </View>
    );

  const totalBurn = bd?.totalBurn ?? (
    (bd?.bmr ?? 0) + (bd?.stepCalories ?? 0) + (bd?.runActual ?? bd?.runPredicted ?? bd?.runCalories ?? 0) + (bd?.gymCalories ?? 0)
  );

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-2xl gap-4">
        <View className="w-full flex-row items-center justify-between">
          <Button label="‹" variant="ghost" size="sm" onPress={() => setDATE((d) => shiftDate(d, -1))} />
          <View className="flex-row items-center gap-2">
            <Text variant="title">{isToday ? "Today" : niceDate(DATE)}</Text>
            {dayClosed ? <Badge label="Closed" tone="success" /> : <Badge label="Nutrition" tone="teal" />}
            {manualOverride ? <Badge label="Offset Plan" tone="warm" /> : null}
          </View>
          <Button label="›" variant="ghost" size="sm" disabled={isToday} onPress={() => setDATE((d) => shiftDate(d, 1))} />
        </View>
        {(!isToday || dayClosed || manualOverride || (meals.length === 0 && !dayClosed)) ? (
          <View className="flex-row flex-wrap items-center justify-center gap-2">
            {!isToday ? (
              <Button label="Jump to today" variant="ghost" size="sm" onPress={() => setDATE(todayLocal())} />
            ) : null}
            {dayClosed ? (
              <Button label={reopenBusy ? "…" : "Reopen day"} variant="ghost" size="sm" disabled={reopenBusy} onPress={onReopen} />
            ) : null}
            {meals.length === 0 && !dayClosed ? (
              <Button label={copyBusy ? "…" : "Copy yesterday"} variant="ghost" size="sm" disabled={copyBusy} onPress={onCopyYesterday} />
            ) : null}
            {manualOverride ? (
              <Button label={unlockBusy ? "…" : "✕ Unlock plan"} variant="ghost" size="sm" disabled={unlockBusy} onPress={onUnlock} />
            ) : null}
          </View>
        ) : null}

        {error ? (
          <Card><Text variant="body" className="text-danger">Couldn&apos;t reach soma: {error}</Text></Card>
        ) : null}

        <Card variant="glow" className="gap-4">
          <SegmentedControl options={["Day", "Trend"] as const} value={tab} onChange={setTab} />
          <View className="items-center gap-1">
            {plan ? (
              <>
                <Text variant="display">{loading ? "…" : (remaining?.calories ?? 0).toLocaleString()}</Text>
                <Text variant="caption" className="text-text-muted">
                  kcal left · {(consumed?.calories ?? 0).toLocaleString()} of {targetCal.toLocaleString()} eaten
                </Text>
              </>
            ) : (
              <>
                <Text variant="display">{loading ? "…" : (consumed?.calories ?? 0).toLocaleString()}</Text>
                <Text variant="caption" className="text-text-muted">kcal eaten today</Text>
              </>
            )}
          </View>

          <View className="gap-2.5">
            {(() => {
              const t = {
                protein: Number(plan?.target_protein) || 0,
                carbs: Number(plan?.target_carbs) || 0,
                fat: Number(plan?.target_fat) || 0,
                fiber: Number(plan?.target_fiber) || 0,
              };
              const marks = buildMacroMarkers(Number(bd?.weightKg) || 0, t);
              return MACROS.map((m) => {
                const eaten = (consumed as Record<string, number> | undefined)?.[m.key] ?? 0;
                const markers = marks[m.key as keyof typeof marks];
                return (
                  <MacroGoalBar
                    key={m.key}
                    label={m.label}
                    current={eaten}
                    target={t[m.key as keyof typeof t]}
                    color={m.color}
                    markers={markers}
                  />
                );
              });
            })()}
            <Text variant="micro" className="text-text-muted">
              {(bd?.weightKg ?? 0) > 0
                ? "Protein & fat ticks are g/kg tiers · green = optimal · red = ceiling"
                : "green = optimal target · red = ceiling"}
            </Text>
          </View>
        </Card>

        {tab === "Day" ? (
          <>
            {/* Today's activity — the inputs that drive the day's burn (locked once closed) */}
            {plan && !dayClosed ? (
              <ActivitySelector
                date={DATE}
                runEnabled={data?.runEnabled ?? true}
                plannedRunKm={Number(plan?.planned_run_km) || 0}
                expectedSteps={bd?.expectedSteps ?? (Number(plan?.expected_steps) || 8000)}
                selectedWorkouts={data?.selectedWorkouts ?? []}
                runDistanceKm={bd?.runDistanceKm ?? 0}
                onChanged={refetch}
              />
            ) : null}

            {/* Burn breakdown — why today's target is what it is */}
            {bd ? (
              <Card className="gap-0.5">
                <Text variant="eyebrow" className="mb-1">Burn breakdown</Text>
                {burnRow("Passive (BMR)", bd.bmr)}
                {burnRow(`Steps${bd.actualSteps ? ` · ${bd.actualSteps.toLocaleString()}` : ""}`, bd.stepCalories)}
                {bd.runEnabled ? burnRow(`Run${bd.runActual ? "" : " (planned)"}`, bd.runActual ?? bd.runPredicted ?? bd.runCalories, { amber: !bd.runActual }) : null}
                {burnRow("Gym", bd.gymCalories)}
                {(bd.drinkCalories ?? 0) > 0 ? burnRow("Drinks", bd.drinkCalories, { amber: true }) : null}
                {burnRow("Total burn", totalBurn, { bold: true })}
              </Card>
            ) : null}

            {/* Adaptive (display-only) */}
            {adaptive && (adaptive.driftFlag || adaptive.dietBreakLevel !== "none") ? (
              <Card className="gap-1">
                <Text variant="eyebrow">Adaptive</Text>
                {adaptive.dietBreakLevel !== "none" ? (
                  <View className="flex-row justify-between">
                    <Text variant="caption" className="font-semibold text-warning">Diet break {adaptive.dietBreakLevel}</Text>
                    <Text variant="caption" className="text-text-muted tabular-nums">{adaptive.deficitDurationDays}d in deficit</Text>
                  </View>
                ) : null}
                {adaptive.driftFlag ? (
                  <Text variant="caption" className="text-warning">TDEE drift: ~{Math.round(adaptive.effectiveTdee)} vs {Math.round(adaptive.reportedTdee)}</Text>
                ) : null}
                <Text variant="micro">Informational — your targets are unchanged.</Text>
              </Card>
            ) : null}

            {/* Per-slot meal cards — logged meals + delete + quick-log + skip */}
            {slots.map((s) => {
              const slotMeals = meals.filter((m) => m.meal_slot === s);
              const budget = data?.slotBudgets?.[s]?.calories ?? 0;
              const eatenInSlot = slotMeals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
              const isSkipped = skippedSlots.includes(s);
              if (budget <= 0 && slotMeals.length === 0 && !isSkipped) return null;
              return (
                <Card key={s} className="gap-2">
                  <View className="flex-row items-center justify-between">
                    <Text variant="title">{slotLabel(s)}</Text>
                    {isSkipped ? (
                      <Badge label="Skipped" tone="neutral" />
                    ) : (
                      <Text variant="caption" className="tabular-nums text-text-muted">
                        {Math.round(eatenInSlot)}{budget > 0 ? ` / ${Math.round(budget)}` : ""} kcal
                      </Text>
                    )}
                  </View>
                  {isSkipped ? (
                    <Button label={skipBusy === s ? "…" : "Un-skip"} variant="ghost" size="sm" className="self-start" disabled={skipBusy != null} onPress={() => onSkip(s)} />
                  ) : (
                    <>
                      {budget > 0 ? <ProgressBar pct={Math.min(eatenInSlot / budget, 1)} color={eatenInSlot > budget ? "#e0a458" : "#77c8d1"} /> : null}
                      {slotMeals.map((m) => (
                        <Pressable key={m.id} onPress={() => setDetailMeal(m)} className="flex-row items-center gap-2 border-b border-border-subtle py-1.5">
                          <View className="flex-1">
                            <Text variant="body" className="text-text" numberOfLines={1}>{mealName(m)}</Text>
                            <Text variant="micro" className="tabular-nums">
                              {Math.round(m.calories)} kcal · P{Math.round(m.protein)} C{Math.round(m.carbs)} F{Math.round(m.fat)}
                            </Text>
                          </View>
                          <Text variant="body" className="text-text-muted">›</Text>
                        </Pressable>
                      ))}
                      {!dayClosed ? (
                        <View className="flex-row gap-2 self-start">
                          <Button label={`+ Log ${slotLabel(s)}`} variant="secondary" size="sm" onPress={() => { setSlot(s); setLogOpen(true); }} />
                          <Button label={skipBusy === s ? "…" : "Skip"} variant="ghost" size="sm" disabled={skipBusy != null} onPress={() => onSkip(s)} />
                        </View>
                      ) : null}
                    </>
                  )}
                </Card>
              );
            })}

            {closeStatus ? (
              <View className="flex-row items-center justify-center">
                <Badge label={closeStatus === "closed" ? "Day closed" : "Already closed"} tone="success" />
              </View>
            ) : null}

            {!dayClosed ? (
              <View className="flex-row gap-3">
                <Button label="Log a drink" variant="secondary" className="flex-1" onPress={() => setDrinkOpen(true)} />
                <Button label="Close day" variant="secondary" className="flex-1" onPress={() => setCloseOpen(true)} />
              </View>
            ) : (
              <View className="flex-row items-center justify-center gap-2">
                <Text variant="micro" className="text-text-muted">Day closed.</Text>
                <Button label={reopenBusy ? "…" : "Reopen to edit"} variant="ghost" size="sm" disabled={reopenBusy} onPress={onReopen} />
              </View>
            )}
          </>
        ) : (
          <>
            {/* Trend tab — body-composition trajectory, then adherence + 7-day table */}
            <BodyCompChart visible={tab === "Trend"} />
            {adherence ? (
              <Card className="gap-2">
                <Text variant="eyebrow">Weekly adherence</Text>
                <ProgressBar pct={Math.min(adherence.ratio, 1)} color="#6ad4a0" />
                <View className="flex-row justify-between">
                  <Text variant="caption" className="text-text-secondary tabular-nums">{adherence.weeklyActual} / {adherence.weeklyGoal} kcal</Text>
                  <Text variant="caption" className="text-warning tabular-nums">{adherence.status.replace(/_/g, " ")} · {Math.round(adherence.ratio * 100)}%</Text>
                </View>
                {caloriesTrend.length >= 2 ? (
                  <View className="mt-1 gap-1">
                    <Text variant="micro" className="text-text-muted">14-day calories</Text>
                    <Sparkline data={caloriesTrend} color="#b17850" height={28} baseline />
                  </View>
                ) : null}
              </Card>
            ) : null}

            {days.length ? (
              <Card className="gap-0.5">
                <View className="flex-row justify-between pb-1">
                  <Text variant="eyebrow">7-day trend</Text>
                  <Text variant="micro" className="text-text-muted">ate / burn · deficit</Text>
                </View>
                {days.map((d) => (
                  <View key={d.date} className="flex-row items-center justify-between border-b border-border-subtle py-1.5">
                    <Text variant="caption" className={d.isToday ? "font-semibold text-teal" : "text-text-secondary"}>
                      {niceDate(d.date).replace(/,.*/, "").slice(0, 3)} {d.date.slice(8)}
                    </Text>
                    <Text variant="caption" className="tabular-nums text-text-muted">{Math.round(d.ate)} / {Math.round(d.burn)}</Text>
                    <Text variant="caption" className={`w-16 text-right tabular-nums ${d.deficit >= 0 ? "text-success" : "text-warm"}`}>
                      {d.deficit > 0 ? "+" : ""}{Math.round(d.deficit)}
                    </Text>
                  </View>
                ))}
              </Card>
            ) : (
              <Card><Text variant="body" className="text-text-secondary">No trend data yet.</Text></Card>
            )}
          </>
        )}
      </View>

      {/* Log-meal modal — preset picker, prefilled to the tapped slot */}
      <Modal visible={logOpen} onClose={() => { setLogOpen(false); setEditMeal(null); }} title={editMeal ? `Edit ${slotLabel(slot)}` : `Log ${slotLabel(slot)}`}>
        <PillGroup className="mb-3">
          {slots.map((s) => (
            <Pill key={s} label={slotLabel(s)} active={slot === s} onPress={() => setSlot(s)} />
          ))}
        </PillGroup>
        <View className="mb-3 flex-row gap-1.5">
          <Button label="Presets" variant={logMode === "preset" ? "secondary" : "ghost"} size="sm" onPress={() => { setLogMode("preset"); setEditMeal(null); }} />
          <Button label="Quick add" variant={logMode === "quick" ? "secondary" : "ghost"} size="sm" onPress={() => { setLogMode("quick"); setEditMeal(null); }} />
          <Button label={editMeal ? "Editing" : "Compose"} variant={logMode === "compose" ? "secondary" : "ghost"} size="sm" onPress={() => { setLogMode("compose"); setEditMeal(null); }} />
        </View>
        {logMode === "compose" ? (
          <ComposeMealView
            ingredients={ingredients}
            date={DATE}
            slot={slot}
            initialGrams={editMeal?.grams}
            editMealId={editMeal?.id ?? null}
            onLogged={() => { setLogOpen(false); setEditMeal(null); refetch(); }}
          />
        ) : logMode === "quick" ? (
          <View className="gap-2 rounded-lg border border-border-subtle p-3">
            <TextInput
              placeholder="Name (e.g. Restaurant burger)"
              placeholderTextColor="#5a7a8a"
              value={qName}
              onChangeText={setQName}
              className="rounded-md border border-border-subtle px-3 py-2 text-text"
            />
            <View className="flex-row gap-2">
              <TextInput placeholder="kcal" placeholderTextColor="#5a7a8a" keyboardType="numeric" value={qCal} onChangeText={setQCal} className="flex-1 rounded-md border border-border-subtle px-2 py-2 text-text tabular-nums" />
              <TextInput placeholder="P" placeholderTextColor="#5a7a8a" keyboardType="numeric" value={qP} onChangeText={setQP} className="flex-1 rounded-md border border-border-subtle px-2 py-2 text-text tabular-nums" />
              <TextInput placeholder="C" placeholderTextColor="#5a7a8a" keyboardType="numeric" value={qC} onChangeText={setQC} className="flex-1 rounded-md border border-border-subtle px-2 py-2 text-text tabular-nums" />
              <TextInput placeholder="F" placeholderTextColor="#5a7a8a" keyboardType="numeric" value={qF} onChangeText={setQF} className="flex-1 rounded-md border border-border-subtle px-2 py-2 text-text tabular-nums" />
            </View>
            <View className="flex-row justify-end gap-2">
              <Button label="Cancel" variant="ghost" size="sm" onPress={() => setLogMode("preset")} />
              <Button label={qBusy ? "…" : "Add"} variant="primary" size="sm" disabled={qBusy || !qCal} onPress={onQuickAdd} />
            </View>
          </View>
        ) : (
          <ScrollView className="max-h-80">
            {pickerPresets.map((p) => (
              <View key={p.id} className="flex-row items-center gap-2 border-b border-border-subtle py-2.5">
                <View className="flex-1">
                  <Text variant="body" className="text-text" numberOfLines={1}>{p.name}</Text>
                  <Text variant="micro" className="tabular-nums">
                    {p.meal_slot ? slotLabel(p.meal_slot) + " · " : ""}{Math.round(p.total_calories)} kcal · P{Math.round(p.total_protein)} C{Math.round(p.total_carbs)} F{Math.round(p.total_fat)}
                  </Text>
                </View>
                <Button label={busyId === p.id ? "…" : "Log"} variant="secondary" size="sm" disabled={busyId != null} onPress={() => onLog(p)} />
              </View>
            ))}
          </ScrollView>
        )}
        <View className="mt-4 flex-row justify-end">
          <Button label={logMode === "compose" ? "Cancel" : "Done"} variant={logMode === "compose" ? "ghost" : "primary"} onPress={() => { setLogOpen(false); setEditMeal(null); }} />
        </View>
      </Modal>

      {/* Logged-meal detail — tap a meal to see macros + ingredients, edit or delete */}
      <MealDetailModal
        meal={detailMeal}
        name={detailMeal ? mealName(detailMeal) : ""}
        slotLabel={slotLabel}
        deleting={delId != null}
        onClose={() => setDetailMeal(null)}
        onDelete={onDetailDelete}
        onEdit={detailMeal ? () => onEditMeal(detailMeal) : undefined}
      />

      {/* Log-drink modal */}
      <Modal visible={drinkOpen} onClose={() => setDrinkOpen(false)} title="Log a drink">
        {loggedDrinks.length ? (
          <View className="mb-3 gap-1">
            <Text variant="eyebrow" className="text-text-muted">Logged today</Text>
            {loggedDrinks.map((d) => (
              <View key={d.id} className="flex-row items-center gap-2 border-b border-border-subtle py-1.5">
                <View className="flex-1">
                  <Text variant="caption" className="text-text" numberOfLines={1}>
                    {d.quantity > 1 ? `${d.quantity}× ` : ""}{d.name}
                  </Text>
                  <Text variant="micro" className="text-text-muted tabular-nums">
                    {Math.round(d.calories)} kcal{d.fat_oxidation_pause_hours ? ` · fat-ox paused ${d.fat_oxidation_pause_hours}h` : ""}
                  </Text>
                </View>
                <Button label={delDrinkId === d.id ? "…" : "✕"} variant="ghost" size="sm" disabled={delDrinkId != null} onPress={() => onDeleteDrink(d.id)} />
              </View>
            ))}
          </View>
        ) : null}
        <Text variant="caption" className="mb-2 text-text-secondary">One default serving is logged per tap.</Text>
        <ScrollView className="max-h-80">
          {drinks.map((d) => (
            <View key={d.key} className="flex-row items-center gap-2 border-b border-border-subtle py-2.5">
              <View className="flex-1">
                <Text variant="body" className="text-text" numberOfLines={1}>{d.name}</Text>
                <Text variant="micro" className="tabular-nums">
                  {Math.round((d.calories_per_100ml * d.default_ml) / 100)} kcal · {d.alcohol_pct}% · {d.default_ml}ml
                </Text>
              </View>
              <Button label={drinkBusy === d.key ? "…" : "Log"} variant="secondary" size="sm" disabled={drinkBusy != null} onPress={() => onLogDrink(d.key)} />
            </View>
          ))}
        </ScrollView>
        <View className="mt-4 flex-row justify-end">
          <Button label="Done" variant="primary" onPress={() => setDrinkOpen(false)} />
        </View>
      </Modal>

      {/* Close-day confirm */}
      <Modal visible={closeOpen} onClose={() => setCloseOpen(false)} title="Close this day?">
        <Text variant="body" className="text-text-secondary">Finalizing locks in today&apos;s totals and updates your trend. You can reopen it later.</Text>
        <View className="mt-4 flex-row justify-end gap-2">
          <Button label="Cancel" variant="ghost" onPress={() => setCloseOpen(false)} />
          <Button label={closing ? "Closing…" : "Close day"} variant="primary" disabled={closing} onPress={onCloseDay} />
        </View>
      </Modal>
    </ScrollView>
  );
}
