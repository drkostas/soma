import { useState, useMemo, useEffect } from "react";
import { View, ScrollView, TextInput, Pressable } from "react-native";
import { IngredientResearchSheet } from "./ingredient-research-sheet";
import { Text, Button } from "soma-style";
import {
  logComposedMeal, deleteMeal, savePreset,
  isCountBased, countToGrams, gramsToCount, rawToCooked, cookedToRaw, hasRawCookedToggle,
  type Ingredient, type ComposeItem,
} from "../lib/api";
import { solvePortions, computeItemMacros, type Ingredient as MEIngredient } from "macro-engine-core";

/** The app Ingredient is structurally the macro-engine-core Ingredient (only `unit`
 *  differs by null vs undefined); cast so the app shares web's solver + macro math. */
const mei = (ing: Ingredient): MEIngredient => ing as unknown as MEIngredient;
const im = (ing: Ingredient, grams: number) => computeItemMacros(mei(ing), grams);

const CATEGORY_LABELS: Record<string, string> = {
  protein: "Protein", carbs: "Carbs", grain: "Grain", vegetable: "Vegetable", fat: "Fat",
  dairy: "Dairy", fruit: "Fruit", sauce: "Sauce", supplement: "Supplement",
};
const CATEGORY_ORDER = ["protein", "carbs", "grain", "vegetable", "fat", "dairy", "fruit", "sauce", "supplement"];

/** Readable name from meal items, e.g. "Chicken Breast, Rice & Broccoli".
 *  Mirrors web's autoMealName (supplements/liquids sorted last). */
function autoMealName(items: { ingredient_id: string; name?: string }[]): string {
  if (!items.length) return "Custom meal";
  const pr = (id: string) => {
    const s = (id || "").toLowerCase();
    if (/whey|protein_powder|creatine|supplement|flax/.test(s)) return 3;
    if (/milk|water|juice|yogurt/.test(s)) return 2;
    return 1;
  };
  const sorted = [...items].sort((a, b) => pr(a.ingredient_id || a.name || "") - pr(b.ingredient_id || b.name || ""));
  const names = sorted.slice(0, 3).map((it) =>
    (it.name || it.ingredient_id || "")
      .replace(/_raw$/, "").replace(/_(dry|whole)$/i, "").replace(/_\d+pct$/i, "")
      .replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim());
  if (names.length <= 1) return names[0] || "Custom meal";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]}, ${names[1]} & ${names[2]}`;
}

/** Compose a meal from raw ingredients: search + category-grouped picker,
 *  per-ingredient editors (grams, or pieces for count-based, or cooked weight),
 *  a max-yolks clamp, live macros + running totals + a volume-score hint, and
 *  a save-as-preset step after logging. Full parity with the web ComposeMealView. */
export function ComposeMealView({
  ingredients, date, slot, slotBudget, onLogged, initialGrams, editMealId, onTotalsChange, onIngredientAdded,
}: {
  ingredients: Ingredient[]; date: string; slot: string; onLogged: () => void;
  /** The slot's kcal budget — seeds the auto-solver so the preview ≈ budget (web parity). */
  slotBudget?: number;
  /** Pre-select ingredients (id -> grams) — used when editing a logged meal. */
  initialGrams?: Record<string, number>;
  /** When set, saving deletes this meal after re-logging (edit = replace). */
  editMealId?: number | null;
  /** Emits the in-progress meal totals on every change, so the screen can fold
   *  them into the day's live preview (remaining kcal + macro bars). */
  onTotalsChange?: (t: { calories: number; protein: number; carbs: number; fat: number; fiber: number }) => void;
  /** A researched ingredient was confirmed into the catalog — the parent refetches presets (T3a). */
  onIngredientAdded?: (ing: Ingredient) => void;
}) {
  const [search, setSearch] = useState("");
  const [researchOpen, setResearchOpen] = useState(false);
  const [grams, setGrams] = useState<Record<string, number>>(initialGrams ?? {});
  const [busy, setBusy] = useState(false);
  const [cookedMode, setCookedMode] = useState<Set<string>>(new Set());
  const [gramMode, setGramMode] = useState<Set<string>>(new Set());
  const [maxYolks, setMaxYolks] = useState(1);
  const [savePrompt, setSavePrompt] = useState<{ items: ComposeItem[]; totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number }; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const initKey = initialGrams ? Object.entries(initialGrams).map(([k, v]) => `${k}:${v}`).join(",") : "";
  useEffect(() => { if (initialGrams) setGrams(initialGrams); }, [initKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const selectedIds = Object.keys(grams).filter((id) => (grams[id] ?? 0) > 0 && byId.has(id));

  const filtered = search.trim()
    ? ingredients.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
    : ingredients;
  const groups = useMemo(() => {
    const m = new Map<string, Ingredient[]>();
    for (const ing of filtered) {
      const c = ing.category || "other";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(ing);
    }
    const order = [...CATEGORY_ORDER, ...[...m.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
    return order.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
  }, [filtered]);

  const totals = selectedIds.reduce(
    (a, id) => {
      const mm = im(byId.get(id)!, grams[id]);
      return { calories: a.calories + mm.calories, protein: a.protein + mm.protein, carbs: a.carbs + mm.carbs, fat: a.fat + mm.fat, fiber: a.fiber + mm.fiber };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );
  const totalGrams = selectedIds.reduce((s, id) => s + (grams[id] || 0), 0);
  const volumeScore = totals.calories > 0 ? totalGrams / totals.calories : 0;

  // Push the running totals up so the screen's day preview updates live.
  useEffect(() => {
    onTotalsChange?.(totals);
  }, [totals.calories, totals.protein, totals.carbs, totals.fat, totals.fiber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Web parity: adding an ingredient re-solves the whole selection to the slot's
  // kcal budget (+30g MPS protein floor) via solvePortions, so the preview totals
  // land near the budget immediately instead of dropping in a flat 100g.
  const add = (id: string) => setGrams((g) => {
    const ids = new Set(Object.keys(g).filter((k) => (g[k] ?? 0) > 0 && byId.has(k)));
    ids.add(id);
    const sel = [...ids].map((k) => byId.get(k)).filter((x): x is Ingredient => !!x);
    if (!slotBudget || slotBudget <= 0 || sel.length === 0) {
      return { ...g, [id]: g[id] && g[id] > 0 ? g[id] : 100 };
    }
    const next: Record<string, number> = {};
    for (const p of solvePortions(sel.map(mei), { calories: slotBudget })) next[p.ingredient_id] = p.grams;
    return next;
  });
  const setG = (id: string, v: number) => setGrams((g) => ({ ...g, [id]: Math.max(0, Math.round(v)) }));
  const remove = (id: string) => setGrams((g) => { const n = { ...g }; delete n[id]; return n; });
  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (id: string) =>
    setter((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleCooked = toggleSet(setCookedMode);
  const toggleGramMode = toggleSet(setGramMode);

  // Clamp whole-egg grams to the yolk cap when the max changes (mirrors web).
  useEffect(() => {
    const ing = byId.get("eggs_whole");
    if (!ing || !(grams["eggs_whole"] > 0)) return;
    const maxGrams = (Number(ing.grams_per_unit) || 50) * maxYolks;
    if (grams["eggs_whole"] > maxGrams) setG("eggs_whole", maxGrams);
  }, [maxYolks]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildItems(): ComposeItem[] {
    return selectedIds.map((id) => {
      const ing = byId.get(id)!;
      const m = im(ing, grams[id]);
      return { ingredient_id: id, name: ing.name, grams: grams[id], calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber };
    });
  }

  async function onLog() {
    setBusy(true);
    const items = buildItems();
    const ok = await logComposedMeal(date, slot, items);
    if (ok && editMealId != null) await deleteMeal(editMealId);
    setBusy(false);
    if (!ok) return;
    if (editMealId == null) {
      // New meal — offer to save it as a preset before closing.
      const t = { calories: Math.round(totals.calories), protein: Math.round(totals.protein), carbs: Math.round(totals.carbs), fat: Math.round(totals.fat), fiber: Math.round(totals.fiber) };
      setSavePrompt({ items, totals: t, name: autoMealName(items) });
    } else {
      setGrams({}); onLogged();
    }
  }

  async function onSavePreset() {
    if (!savePrompt) return;
    setSaving(true); setSaveErr(null);
    const ok = await savePreset(savePrompt.name.trim(), savePrompt.items, slot, savePrompt.totals);
    setSaving(false);
    if (ok) { setSavePrompt(null); setGrams({}); onLogged(); }
    else setSaveErr("Couldn't save preset.");
  }

  // Save-as-preset step (after a new meal is logged).
  if (savePrompt) {
    return (
      <View className="gap-3 rounded-lg border border-dashed border-border-subtle p-3">
        <Text variant="caption" className="text-text-secondary">Meal logged. Save it as a preset for reuse?</Text>
        <TextInput
          value={savePrompt.name}
          onChangeText={(v) => setSavePrompt((p) => (p ? { ...p, name: v } : p))}
          placeholder="Preset name"
          placeholderTextColor="#5a7a8a"
          className="rounded-md border border-border-subtle px-3 py-2 text-text"
        />
        {saveErr ? <Text variant="micro" className="text-danger">{saveErr}</Text> : null}
        <View className="flex-row justify-end gap-2">
          <Button label="Skip" variant="ghost" size="sm" onPress={() => { setSavePrompt(null); setGrams({}); onLogged(); }} />
          <Button label={saving ? "…" : "Save preset"} variant="primary" size="sm" disabled={saving || !savePrompt.name.trim()} onPress={onSavePreset} />
        </View>
      </View>
    );
  }

  return (
    <View className="gap-3">
      {/* Selected ingredients — grams / pieces / cooked-weight editors + live macros */}
      {selectedIds.length ? (
        <View className="gap-2 rounded-lg border border-border-subtle p-3">
          <Text variant="eyebrow" className="text-text-muted">In this meal</Text>
          {selectedIds.map((id) => {
            const ing = byId.get(id)!;
            const g = grams[id];
            const m = im(ing, g);
            const asCount = isCountBased(ing) && !gramMode.has(id);
            const canCook = hasRawCookedToggle(ing);
            const asCooked = canCook && cookedMode.has(id);

            let displayVal: string;
            let onMinus: () => void;
            let onPlus: () => void;
            if (asCount) {
              const count = gramsToCount(ing, g);
              const step = Number(ing.unit_step) || 1;
              displayVal = `${count} ${ing.unit || "pcs"}`;
              onMinus = () => setG(id, countToGrams(ing, Math.max(0, count - step)));
              onPlus = () => setG(id, countToGrams(ing, count + step));
            } else if (asCooked) {
              const cooked = rawToCooked(ing, g);
              displayVal = `${cooked} g`;
              onMinus = () => setG(id, cookedToRaw(ing, Math.max(0, cooked - 10)));
              onPlus = () => setG(id, cookedToRaw(ing, cooked + 10));
            } else {
              displayVal = `${g} g`;
              onMinus = () => setG(id, g - 10);
              onPlus = () => setG(id, g + 10);
            }

            return (
              <View key={id} className="border-b border-border-subtle pb-1.5">
                <View className="flex-row items-center gap-2">
                  <View className="flex-1">
                    <Text variant="caption" className="text-text" numberOfLines={1}>{ing.name}</Text>
                    <Text variant="micro" className="text-text-muted tabular-nums">
                      {Math.round(m.calories)} kcal · P{Math.round(m.protein)} C{Math.round(m.carbs)} F{Math.round(m.fat)}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Button label="−" variant="ghost" size="sm" onPress={onMinus} />
                    <Text variant="caption" className="w-16 text-center tabular-nums">{displayVal}</Text>
                    <Button label="+" variant="ghost" size="sm" onPress={onPlus} />
                    <Button label="✕" variant="ghost" size="sm" onPress={() => remove(id)} />
                  </View>
                </View>
                {canCook || isCountBased(ing) ? (
                  <View className="flex-row gap-4 pt-0.5">
                    {canCook ? (
                      <Pressable onPress={() => toggleCooked(id)} hitSlop={6}>
                        <Text variant="micro" className="text-teal">{asCooked ? `cooked (${g}g raw)` : "switch to cooked weight"}</Text>
                      </Pressable>
                    ) : null}
                    {isCountBased(ing) ? (
                      <Pressable onPress={() => toggleGramMode(id)} hitSlop={6}>
                        <Text variant="micro" className="text-teal">{gramMode.has(id) ? `switch to ${ing.unit || "pcs"}` : "switch to grams"}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}

          {/* Max yolks/day — clamps whole-egg grams */}
          {selectedIds.includes("eggs_whole") ? (
            <View className="flex-row items-center justify-between rounded-md px-2 py-1.5" style={{ backgroundColor: "#11202066" }}>
              <Text variant="micro" className="text-text-muted">Max yolks / day</Text>
              <View className="flex-row items-center gap-1.5">
                {[1, 2, 3].map((n) => (
                  <Pressable key={n} onPress={() => setMaxYolks(n)} hitSlop={4}>
                    <View className="h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: maxYolks === n ? "#77c8d1" : "#152232" }}>
                      <Text variant="caption" style={{ color: maxYolks === n ? "#0a1720" : "#a0b4c0" }}>{n}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {totals.calories > 0 ? (
            <Text variant="micro" className="text-center" style={{ color: volumeScore >= 1.5 ? "#6ad4a0" : volumeScore >= 0.8 ? "#5a7a8a" : "#e0a458" }}>
              {volumeScore >= 1.5 ? "High volume — great for satiety" : volumeScore >= 0.8 ? `${Math.round(totalGrams)}g total` : `${Math.round(totalGrams)}g total — low volume`}
            </Text>
          ) : null}

          <View className="flex-row items-center justify-between pt-1">
            <Text variant="caption" className="font-semibold tabular-nums">
              {Math.round(totals.calories)} kcal · P{Math.round(totals.protein)} C{Math.round(totals.carbs)} F{Math.round(totals.fat)}
            </Text>
            <Button label={busy ? "…" : editMealId != null ? "Save changes" : "Log meal"} variant="primary" size="sm" disabled={busy || selectedIds.length === 0} onPress={onLog} />
          </View>
        </View>
      ) : null}

      {/* Search + category-grouped ingredient picker */}
      <TextInput
        placeholder="Search ingredients…"
        placeholderTextColor="#5a7a8a"
        value={search}
        onChangeText={setSearch}
        className="rounded-md border border-border-subtle px-3 py-2 text-text"
      />
      {/* T3a: the catalog is not the world. Research a food from USDA / Open Food Facts and confirm it — above the
          list so it is reachable without scrolling 80+ rows (a person or a Maestro flow). */}
      <Pressable testID="research-row" onPress={() => setResearchOpen(true)} className="flex-row items-center gap-2 py-1">
        <Text variant="caption" className="text-teal">{search.trim() ? `Not finding it? Research “${search.trim()}”…` : "Not finding it? Research an ingredient…"}</Text>
      </Pressable>
      <ScrollView className="max-h-72" keyboardShouldPersistTaps="handled">
        {groups.length === 0 ? (
          <Text variant="caption" className="text-text-muted">No ingredients match.</Text>
        ) : groups.map(([cat, list]) => (
          <View key={cat} className="mb-2">
            <Text variant="micro" className="mb-1 text-text-muted">{CATEGORY_LABELS[cat] ?? cat}</Text>
            {list.map((ing) => {
              const on = (grams[ing.id] ?? 0) > 0;
              return (
                <Pressable key={ing.id} onPress={() => (on ? remove(ing.id) : add(ing.id))} className="flex-row items-center justify-between border-b border-border-subtle py-1.5">
                  <Text variant="caption" className={on ? "text-teal" : "text-text"} numberOfLines={1}>{ing.name}</Text>
                  <Text variant="micro" className="text-text-muted tabular-nums">{on ? "✓ " : ""}{Math.round(ing.calories_per_100g)}/100g</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <IngredientResearchSheet
        visible={researchOpen}
        initialQuery={search.trim()}
        onClose={() => setResearchOpen(false)}
        onConfirmed={(ing) => {
          onIngredientAdded?.(ing);
          // select it right away; the row renders once the parent's refetch lands
          setGrams((g) => ({ ...g, [ing.id]: 100 }));
          setSearch("");
        }}
      />
    </View>
  );
}
