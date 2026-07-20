import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { Text, Card, Badge, SegmentedControl, ProgressBar, Button, Modal, Pill, PillGroup } from "soma-style";
import { useSomaPlan, usePresets, logPresetMeal, useDrinks, logDrink, closeDay, fetchJson, usePullRefresh, type Preset } from "../../lib/api";
import { Sparkline } from "../../components/Sparkline";

/** 14-day daily-calories series for the adherence trend sparkline. */
function useCaloriesTrend() {
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    fetchJson<{ calories?: number[] }>("/api/overview/trends")
      .then((d) => alive && setSeries((d.calories ?? []).filter((v) => isFinite(v))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return series;
}

const DATE = "2026-07-16";

const MACROS = [
  { key: "protein", label: "Protein", color: "#b17850", tKey: "target_protein" },
  { key: "carbs", label: "Carbs", color: "#6366b0", tKey: "target_carbs" },
  { key: "fat", label: "Fat", color: "#cbe896", tKey: "target_fat" },
  { key: "fiber", label: "Fiber", color: "#82d0c8", tKey: "target_fiber" },
] as const;

const SLOT_ORDER = ["breakfast", "lunch", "dinner", "pre_sleep", "during_workout"];
const slotLabel = (s: string) => s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function NutritionScreen() {
  const { data, loading, error, refetch } = useSomaPlan(DATE);
  const { refreshing, onRefresh } = usePullRefresh(refetch);
  const { presets } = usePresets();
  const { drinks } = useDrinks();
  const [tab, setTab] = useState<"Day" | "Trajectory">("Day");
  const [refeed, setRefeed] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [slot, setSlot] = useState("lunch");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loggedId, setLoggedId] = useState<string | null>(null);
  const [drinkOpen, setDrinkOpen] = useState(false);
  const [drinkBusy, setDrinkBusy] = useState<string | null>(null);
  const [drinkLogged, setDrinkLogged] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeStatus, setCloseStatus] = useState<string | null>(null);

  const plan = data?.plan;
  const consumed = data?.consumed;
  const remaining = data?.remaining;
  const adaptive = data?.adaptive;
  const adherence = data?.trend7d?.adherence;
  const caloriesTrend = useCaloriesTrend();
  const targetCal = plan?.target_calories ?? 0;

  const availSlots = SLOT_ORDER.filter((s) => data?.slotBudgets?.[s] != null);
  const slots = availSlots.length ? availSlots : SLOT_ORDER;

  async function onLog(preset: Preset) {
    setBusyId(preset.id);
    const ok = await logPresetMeal(DATE, slot, preset);
    setBusyId(null);
    if (ok) {
      setLoggedId(preset.id);
      refetch();
    }
  }

  async function onLogDrink(key: string) {
    setDrinkBusy(key);
    const ok = await logDrink(DATE, key);
    setDrinkBusy(null);
    if (ok) {
      setDrinkLogged(key);
      refetch();
    }
  }

  async function onCloseDay() {
    setClosing(true);
    const status = await closeDay(DATE);
    setClosing(false);
    setCloseStatus(status);
    if (status) {
      setCloseOpen(false);
      refetch();
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center gap-2">
          <Text variant="title">Thursday, Jul 16</Text>
          <Badge label="Nutrition" tone="teal" />
        </View>

        {error ? (
          <Card><Text variant="body" className="text-danger">API: {error} — is soma running on :3456?</Text></Card>
        ) : null}

        <Card variant="glow" className="gap-4">
          <SegmentedControl options={["Day", "Trajectory"] as const} value={tab} onChange={setTab} />
          <View className="items-center gap-1">
            <Text variant="display">{loading ? "…" : ((consumed?.calories ?? 0)).toLocaleString()}</Text>
            <Text variant="caption" className="text-text-muted">/ {targetCal.toLocaleString()} kcal · {(remaining?.calories ?? 0).toLocaleString()} remaining</Text>
          </View>

          {/* Macro bars */}
          <View className="gap-2.5">
            {MACROS.map((m) => {
              const target = (plan as Record<string, number> | undefined)?.[m.tKey] ?? 0;
              const eaten = (consumed as Record<string, number> | undefined)?.[m.key] ?? 0;
              return (
                <View key={m.key} className="gap-1">
                  <View className="flex-row justify-between">
                    <Text variant="caption" className="text-text-secondary">{m.label}</Text>
                    <Text variant="caption" className="tabular-nums text-text-muted">{Math.round(eaten)} / {Math.round(target)}g</Text>
                  </View>
                  <ProgressBar pct={target > 0 ? eaten / target : 0} color={m.color} />
                </View>
              );
            })}
          </View>
        </Card>

        {/* Adaptive (the #68 feature, display-only) */}
        {adaptive && (adaptive.driftFlag || adaptive.dietBreakLevel !== "none") ? (
          <Card className="gap-1">
            <Text variant="eyebrow">Adaptive</Text>
            {adaptive.dietBreakLevel !== "none" ? (
              <View className="flex-row justify-between">
                <Text variant="caption" className="font-semibold text-warning">
                  Diet break {adaptive.dietBreakLevel}
                </Text>
                <Text variant="caption" className="text-text-muted tabular-nums">{adaptive.deficitDurationDays}d in deficit</Text>
              </View>
            ) : null}
            {adaptive.driftFlag ? (
              <Text variant="caption" className="text-warning">TDEE drift: ~{Math.round(adaptive.effectiveTdee)} vs {Math.round(adaptive.reportedTdee)}</Text>
            ) : null}
            <Text variant="micro">Informational — your targets are unchanged.</Text>
          </Card>
        ) : null}

        {/* Adherence (the #69 feature) */}
        {adherence ? (
          <Card className="gap-2">
            <Text variant="eyebrow">Weekly adherence</Text>
            <ProgressBar pct={Math.min(adherence.ratio, 1)} color="#6ad4a0" />
            <View className="flex-row justify-between">
              <Text variant="caption" className="text-text-secondary tabular-nums">{adherence.weeklyActual} / {adherence.weeklyGoal} kcal</Text>
              <Text variant="caption" className="text-warning tabular-nums">{adherence.status.replace("_", " ")} · {Math.round(adherence.ratio * 100)}%</Text>
            </View>
            {caloriesTrend.length >= 2 ? (
              <View className="mt-1 gap-1">
                <Text variant="micro" className="text-text-muted">14-day calories</Text>
                <Sparkline data={caloriesTrend} color="#b17850" height={28} baseline />
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* Meal slots (soma budgets are per-slot kcal) */}
        <Card className="gap-2">
          <Text variant="eyebrow">Per-meal kcal</Text>
          {Object.entries(data?.slotBudgets ?? {})
            .filter(([, v]) => (v?.calories ?? 0) > 0)
            .map(([s, v]) => (
              <View key={s} className="flex-row items-center justify-between border-b border-border-subtle py-2">
                <Text variant="body" className="capitalize text-text-secondary">{s.replace("_", " ")}</Text>
                <Text variant="body" className="tabular-nums text-text">{Math.round(v.calories)} kcal</Text>
              </View>
            ))}
        </Card>

        {closeStatus ? (
          <View className="flex-row items-center justify-center gap-2">
            <Badge label={closeStatus === "closed" ? "Day closed" : "Already closed"} tone="success" />
          </View>
        ) : null}

        <Button label="Log a meal" variant="primary" onPress={() => setLogOpen(true)} />
        <View className="flex-row gap-3">
          <Button label="Log a drink" variant="secondary" className="flex-1" onPress={() => setDrinkOpen(true)} />
          <Button label="Close day" variant="secondary" className="flex-1" onPress={() => setCloseOpen(true)} />
        </View>
        <Button label="Plan a refeed" variant="ghost" onPress={() => setRefeed(true)} />
      </View>

      {/* Log-meal modal — preset-based (soma logs saved meals, not free foods) */}
      <Modal visible={logOpen} onClose={() => setLogOpen(false)} title="Log a meal">
        <Text variant="caption" className="mb-2 text-text-secondary">Add a saved meal to a slot.</Text>
        <PillGroup className="mb-3">
          {slots.map((s) => (
            <Pill key={s} label={slotLabel(s)} active={slot === s} onPress={() => setSlot(s)} />
          ))}
        </PillGroup>
        <ScrollView className="max-h-80">
          {presets.map((p) => {
            const done = loggedId === p.id;
            return (
              <View key={p.id} className="flex-row items-center gap-2 border-b border-border-subtle py-2.5">
                <View className="flex-1">
                  <Text variant="body" className="text-text" numberOfLines={1}>{p.name}</Text>
                  <Text variant="micro" className="tabular-nums">
                    {Math.round(p.total_calories)} kcal · P{Math.round(p.total_protein)} C{Math.round(p.total_carbs)} F{Math.round(p.total_fat)}
                  </Text>
                </View>
                {done ? (
                  <Badge label="Logged" tone="success" />
                ) : (
                  <Button
                    label={busyId === p.id ? "…" : "Log"}
                    variant="secondary"
                    size="sm"
                    disabled={busyId != null}
                    onPress={() => onLog(p)}
                  />
                )}
              </View>
            );
          })}
        </ScrollView>
        <View className="mt-4 flex-row justify-end">
          <Button label="Done" variant="primary" onPress={() => setLogOpen(false)} />
        </View>
      </Modal>

      {/* Log-drink modal — soma's alcohol tracking */}
      <Modal visible={drinkOpen} onClose={() => setDrinkOpen(false)} title="Log a drink">
        <Text variant="caption" className="mb-2 text-text-secondary">One default serving is logged per tap.</Text>
        <ScrollView className="max-h-80">
          {drinks.map((d) => {
            const done = drinkLogged === d.key;
            return (
              <View key={d.key} className="flex-row items-center gap-2 border-b border-border-subtle py-2.5">
                <View className="flex-1">
                  <Text variant="body" className="text-text" numberOfLines={1}>{d.name}</Text>
                  <Text variant="micro" className="tabular-nums">
                    {Math.round((d.calories_per_100ml * d.default_ml) / 100)} kcal · {d.alcohol_pct}% · {d.default_ml}ml
                  </Text>
                </View>
                {done ? (
                  <Badge label="Logged" tone="success" />
                ) : (
                  <Button
                    label={drinkBusy === d.key ? "…" : "Log"}
                    variant="secondary"
                    size="sm"
                    disabled={drinkBusy != null}
                    onPress={() => onLogDrink(d.key)}
                  />
                )}
              </View>
            );
          })}
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

      <Modal visible={refeed} onClose={() => setRefeed(false)} title="Plan a refeed">
        <Text variant="body" className="text-text-secondary">A refeed raises carbs for a day to ease a long deficit.</Text>
        <View className="mt-4 flex-row justify-end gap-2">
          <Button label="Cancel" variant="ghost" onPress={() => setRefeed(false)} />
          <Button label="Add refeed" variant="primary" onPress={() => setRefeed(false)} />
        </View>
      </Modal>
    </ScrollView>
  );
}
