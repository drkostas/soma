"use client";

import { useState, useMemo } from "react";
import { Trash2, Plus, ChevronDown, ChevronUp, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/number-input";
import { IngredientPicker } from "@/components/ingredient-picker";
import { ComposeMealView } from "@/components/compose-meal-view";
import { MealDetailModal } from "@/components/meal-detail-modal";
import { type Ingredient, type PortionResult, solvePortions, computeItemMacros } from "@/lib/portion-solver";

// ── Helpers ───────────────────────────────────────────────────

/** Generate a readable name from meal items, e.g. "Salmon, Broccoli & Yogurt" */
function autoMealName(items: any[]): string {
  if (!items || items.length === 0) return "Custom meal";
  // Sort by calories desc, pick top 3
  const sorted = [...items].sort((a, b) => (b.calories || 0) - (a.calories || 0));
  const top = sorted.slice(0, 3);
  const names = top.map((item) => {
    // Use name field if present, otherwise prettify ingredient_id
    const raw = item.name || item.ingredient_id || "";
    return raw
      .replace(/_raw$/, "")
      .replace(/_(dry|whole)$/i, "")
      .replace(/_\d+pct$/i, "")
      .replace(/^protein_powder_whey$/, "whey")
      .replace(/^greek_yogurt.*/, "yogurt")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase())
      .trim();
  });
  if (names.length <= 1) return names[0] || "Custom meal";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]}, ${names[1]} & ${names[2]}`;
}

// ── Constants ─────────────────────────────────────────────────

const SLOT_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  pre_sleep: "Pre-Sleep",
  during_workout: "During Workout",
};

const SLOT_ICONS: Record<string, string> = {
  breakfast: "\u2600\uFE0F",
  lunch: "\uD83C\uDF24\uFE0F",
  dinner: "\uD83C\uDF19",
  pre_sleep: "\uD83C\uDF19",
  during_workout: "\uD83C\uDFC3",
};

const SLOT_TAG_MAP: Record<string, string[]> = {
  breakfast: ["breakfast"],
  lunch: ["lunch", "dinner"],
  dinner: ["lunch", "dinner"],
  pre_sleep: ["snack", "evening"],
  during_workout: ["pre-run", "during-run", "post-run"],
};

// ── Types ─────────────────────────────────────────────────────

interface Meal {
  id: number;
  meal_slot: string;
  source: string | null;
  preset_meal_id: string | null;
  preset_name: string | null;
  portion_multiplier: number;
  items: any;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  notes: string | null;
  weigh_method: string | null;
  logged_at: string;
}

interface Preset {
  id: string;
  name: string;
  items: any;
  tags: string[] | null;
}

interface MealCardProps {
  slot: string;
  meals: Meal[];
  presets: Preset[];
  date: string;
  disabled: boolean;
  skipped?: boolean;
  slotBudget?: Record<string, number> | null;
  ingredients?: any[];
  onMealLogged: (changedSlot?: string) => void;
  onSlotSkipped?: () => void;
  onTotalsPreview?: (slot: string, totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number } | null) => void;
}

// Read pre-computed macro totals from the preset JSONB blob.
// The preset_meals.items column stores: {items: [...], calories, protein, carbs, fat, fiber}
function estimatePresetMacros(itemsBlob: any): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
} {
  if (itemsBlob && typeof itemsBlob === "object" && !Array.isArray(itemsBlob)) {
    return {
      calories: Number(itemsBlob.calories) || 0,
      protein: Number(itemsBlob.protein) || 0,
      carbs: Number(itemsBlob.carbs) || 0,
      fat: Number(itemsBlob.fat) || 0,
      fiber: Number(itemsBlob.fiber) || 0,
    };
  }
  return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
}

// ── Component ─────────────────────────────────────────────────

export function MealCard({
  slot,
  meals,
  presets,
  date,
  disabled,
  skipped,
  slotBudget,
  ingredients,
  onMealLogged,
  onSlotSkipped,
  onTotalsPreview,
}: MealCardProps) {
  const [expanded, setExpanded] = useState(meals.length > 0);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [logging, setLogging] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [selectedIngredients, setSelectedIngredients] = useState<Set<string>>(new Set());
  const [composedPortions, setComposedPortions] = useState<PortionResult[] | null>(null);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [lastComposedItems, setLastComposedItems] = useState<any[] | null>(null);
  const [lastComposedTotals, setLastComposedTotals] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailMeal, setDetailMeal] = useState<Meal | null>(null);
  const [editingMealId, setEditingMealId] = useState<number | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickCal, setQuickCal] = useState("");
  const [quickP, setQuickP] = useState("");
  const [quickC, setQuickC] = useState("");
  const [quickF, setQuickF] = useState("");

  const handleSkip = async () => {
    setSkipping(true);
    try {
      const res = await fetch("/api/nutrition/skip-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, slot }),
      });
      if (res.ok) {
        onSlotSkipped?.();
      }
    } finally {
      setSkipping(false);
    }
  };

  const slotLabel = SLOT_LABELS[slot] || slot;
  const slotIcon = SLOT_ICONS[slot] || "";
  const totalCal = meals.reduce((s, m) => s + Number(m.calories || 0), 0);

  // Filter presets for this slot
  const slotTags = SLOT_TAG_MAP[slot] || [];
  const filteredPresets = useMemo(
    () =>
      presets.filter((p) => {
        const tags = p.tags || [];
        // Show if any preset tag matches any slot tag, or show all if no tag filter
        if (slotTags.length === 0) return true;
        return tags.some((t) => slotTags.includes(t));
      }),
    [presets, slotTags]
  );

  // Preview macros for selected preset
  const previewMacros = useMemo(() => {
    if (!selectedPreset) return null;
    const base = estimatePresetMacros(selectedPreset.items);
    return {
      calories: Math.round(base.calories * multiplier),
      protein: Math.round(base.protein * multiplier),
      carbs: Math.round(base.carbs * multiplier),
      fat: Math.round(base.fat * multiplier),
      fiber: Math.round(base.fiber * multiplier),
    };
  }, [selectedPreset, multiplier]);

  const handleSelectPreset = (preset: Preset) => {
    setSelectedPreset(preset);
    setMultiplier(1);
  };

  const handleLog = async () => {
    if (!selectedPreset) return;
    setLogging(true);
    try {
      // Extract the actual items array from the JSONB blob,
      // and pass pre-computed macros so the API doesn't need the ingredient DB
      const blob = selectedPreset.items;
      const actualItems = Array.isArray(blob) ? blob : blob?.items ?? [];
      const baseMacros = estimatePresetMacros(blob);

      const res = await fetch("/api/nutrition/log-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          meal_slot: slot,
          preset_meal_id: selectedPreset.id,
          portion_multiplier: multiplier,
          items: actualItems,
          preset_macros: baseMacros,
        }),
      });
      if (res.ok) {
        setSelectedPreset(null);
        setShowPicker(false);
        setMultiplier(1);
        onMealLogged(slot);
      }
    } finally {
      setLogging(false);
    }
  };

  const handleDelete = async (mealId: number) => {
    setDeleting(mealId);
    try {
      const res = await fetch(`/api/nutrition/log-meal?id=${mealId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onMealLogged(slot);
      }
    } finally {
      setDeleting(null);
    }
  };

  const handleCancel = () => {
    setSelectedPreset(null);
    setShowPicker(false);
    setMultiplier(1);
    setEditingMealId(null);
  };

  const handleQuickAdd = async () => {
    setLogging(true);
    try {
      const cal = Number(quickCal) || 0;
      const p = Number(quickP) || 0;
      const c = Number(quickC) || 0;
      const f = Number(quickF) || 0;
      const items = [{
        ingredient_id: `custom_${Date.now()}`,
        grams: 0,
        calories: cal, protein: p, carbs: c, fat: f, fiber: 0,
        name: quickName || "Custom food",
      }];
      await fetch("/api/nutrition/log-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date, meal_slot: slot, source: "quick_add",
          items, calories: cal, protein: p, carbs: c, fat: f, fiber: 0,
        }),
      });
      setShowQuickAdd(false);
      setQuickName(""); setQuickCal(""); setQuickP(""); setQuickC(""); setQuickF("");
      onMealLogged(slot);
    } finally {
      setLogging(false);
    }
  };

  const handleToggleIngredient = (id: string) => {
    setSelectedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleIngredientsDone = () => {
    if (!ingredients?.length || selectedIngredients.size === 0) return;
    const selected = (ingredients as Ingredient[]).filter((i) =>
      selectedIngredients.has(i.id),
    );
    const budget = slotBudget
      ? {
          calories: Number(slotBudget.calories) || 500,
          protein: Number(slotBudget.protein) || 40,
          carbs: Number(slotBudget.carbs) || 50,
          fat: Number(slotBudget.fat) || 20,
        }
      : { calories: 500, protein: 40, carbs: 50, fat: 20 };
    const portions = solvePortions(selected, budget);
    setComposedPortions(portions);
  };

  const handleComposeLog = async (
    items: { ingredient_id: string; grams: number; calories: number; protein: number; carbs: number; fat: number; fiber: number }[],
    totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number },
  ) => {
    setLogging(true);
    try {
      // If editing, delete the old meal first
      if (editingMealId) {
        await fetch(`/api/nutrition/log-meal?id=${editingMealId}`, { method: "DELETE" });
        setEditingMealId(null);
      }

      const res = await fetch("/api/nutrition/log-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          meal_slot: slot,
          items,
        }),
      });
      if (res.ok) {
        // Store for potential save-as-preset
        setLastComposedItems(items);
        setLastComposedTotals(totals);
        setComposedPortions(null);
        setSelectedIngredients(new Set());
        setShowCompose(false);
        onMealLogged(slot);
        // Pre-populate save prompt with auto-generated name
        setSavePresetName(autoMealName(items));
        setShowSavePrompt(true);
      }
    } finally {
      setLogging(false);
    }
  };

  const handleSavePreset = async () => {
    if (!savePresetName.trim() || !lastComposedItems) {
      console.warn("Save preset skipped: name empty or no items", { name: savePresetName, hasItems: !!lastComposedItems });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/nutrition/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: savePresetName.trim(),
          items: lastComposedItems,
          slot,
          totals: lastComposedTotals,
        }),
      });
      if (!res.ok) {
        console.error("Save preset failed:", res.status, await res.text());
        return;
      }
      setShowSavePrompt(false);
      setSavePresetName("");
      setLastComposedItems(null);
      setLastComposedTotals(null);
      onMealLogged(slot); // refresh to show the new preset in the picker
    } catch (err) {
      console.error("Save preset error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDismissSave = () => {
    setShowSavePrompt(false);
    setSavePresetName("");
    setLastComposedItems(null);
    setLastComposedTotals(null);
  };

  const handleCustomizePreset = () => {
    if (!selectedPreset || !ingredients?.length) return;
    const blob = selectedPreset.items;
    const presetItems: { ingredient_id: string; grams: number }[] =
      Array.isArray(blob) ? blob : blob?.items ?? [];
    const ingLookup = new Map(
      (ingredients as Ingredient[]).map((i) => [i.id, i]),
    );
    const portions: PortionResult[] = presetItems
      .map((item) => {
        const ing = ingLookup.get(item.ingredient_id);
        if (!ing) return null;
        const macros = computeItemMacros(ing, item.grams);
        return {
          ingredient_id: item.ingredient_id,
          grams: item.grams,
          increment:
            { protein: 25, carbs: 10, vegetable: 25, fat: 5, dairy: 25, sauce: 10, fruit: 25, supplement: 5 }[ing.category] ?? 10,
          ...macros,
        };
      })
      .filter((p): p is PortionResult => p !== null);
    setComposedPortions(portions);
    setSelectedPreset(null);
    setShowPicker(false);
  };

  const handleEditIngredients = () => {
    // Go back to picker, pre-selecting current ingredients from the composed portions
    if (composedPortions) {
      const ids = new Set(composedPortions.map((p) => p.ingredient_id));
      setSelectedIngredients(ids);
    }
    setComposedPortions(null);
    setShowCompose(true);
  };

  const handleComposeCancel = () => {
    setComposedPortions(null);
    setSelectedIngredients(new Set());
    setShowCompose(false);
    setEditingMealId(null);
    onTotalsPreview?.(slot, null); // clear live preview
  };

  return (
    <Card>
      <button
        className={`w-full flex items-center justify-between px-4 py-3 text-left ${skipped ? "opacity-50" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{slotIcon}</span>
          <span className="font-medium text-sm">{slotLabel}</span>
          {meals.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({meals.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {totalCal > 0 && (
            <span className="text-xs font-medium tabular-nums">
              {Math.round(totalCal)} kcal
            </span>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <CardContent className="pt-0 space-y-2">
          {/* Logged meals */}
          {meals.map((meal) => {
            const itemsList: { ingredient_id?: string; grams?: number; cooked_grams?: number }[] =
              Array.isArray(meal.items) ? meal.items : (meal.items?.items ?? []);
            const ingLookup = new Map(
              ((ingredients ?? []) as Ingredient[]).map((i) => [i.id, i]),
            );
            return (
              <div
                key={meal.id}
                className="rounded-md bg-muted/50 px-3 py-2 text-sm cursor-pointer hover:bg-muted/70 transition-colors"
                onClick={() => setDetailMeal(meal)}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {meal.preset_name || autoMealName(meal.items)}
                      {meal.portion_multiplier !== 1 && (
                        <span className="text-muted-foreground ml-1">
                          ({meal.portion_multiplier}x)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {Math.round(meal.calories)} kcal &middot;{" "}
                      {Math.round(meal.protein)}P &middot;{" "}
                      {Math.round(meal.carbs)}C &middot; {Math.round(meal.fat)}F
                      {!disabled && <span className="text-[9px] ml-1.5 text-muted-foreground/60">20+ min</span>}
                    </div>
                  </div>
                  {!disabled && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleDelete(meal.id); }}
                      disabled={deleting === meal.id}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
                {itemsList.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {(() => {
                      const sortedItems = [...itemsList].sort((a, b) => {
                        const order: Record<string, number> = { vegetable: 0, protein: 1, carbs: 2, fruit: 3, dairy: 4, fat: 5, sauce: 6, supplement: 7 };
                        const catA = ingLookup.get(a.ingredient_id ?? "")?.category ?? "zzz";
                        const catB = ingLookup.get(b.ingredient_id ?? "")?.category ?? "zzz";
                        return (order[catA] ?? 99) - (order[catB] ?? 99);
                      });
                      return sortedItems.map((item, idx) => {
                        const ing = ingLookup.get(item.ingredient_id ?? "");
                        const name = ing?.name ?? item.ingredient_id ?? "?";
                        const rawG = item.grams ?? 0;
                        const ratio = ing?.raw_to_cooked_ratio;
                        const isRaw = ing?.is_raw && ratio && ratio > 0 && ratio !== 1;
                        const cookedG = item.cooked_grams ?? (isRaw ? Math.round(rawG * (ratio as number)) : 0);
                        return (
                          <div key={idx} className="text-[10px] text-muted-foreground flex justify-between">
                            <span>
                              {name}
                              {idx === 0 && ing?.category === "vegetable" && (
                                <span className="text-[8px] text-green-600 ml-1">eat first</span>
                              )}
                            </span>
                            <span className="tabular-nums">
                              {isRaw
                                ? `${cookedG}g cooked (${rawG}g raw)`
                                : `${rawG}g`}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            );
          })}

          {/* Skipped state — show badge with undo */}
          {!disabled && skipped && meals.length === 0 && (
            <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
              <span className="text-xs text-muted-foreground italic">
                Skipped — budget moved to other meals
              </span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleSkip} disabled={skipping}>
                Undo
              </Button>
            </div>
          )}

          {/* Water preload reminder for unfilled slots */}
          {!disabled && !skipped && meals.length === 0 && !showPicker && !selectedPreset && !showCompose && !composedPortions && (
            <div className="text-[10px] text-blue-400 text-center py-0.5">
              Drink 500ml water 30 min before eating
            </div>
          )}

          {/* Quick add form */}
          {showQuickAdd && (
            <div className="space-y-2 p-3 border border-border/50 rounded-lg">
              <input
                placeholder="Name (e.g., Restaurant burger)"
                className="w-full text-sm bg-background border border-border rounded px-2 py-1"
                value={quickName}
                onChange={e => setQuickName(e.target.value)}
              />
              <div className="grid grid-cols-4 gap-2">
                <input placeholder="kcal" type="number" className="text-sm bg-background border border-border rounded px-2 py-1" value={quickCal} onChange={e => setQuickCal(e.target.value)} />
                <input placeholder="P" type="number" className="text-sm bg-background border border-border rounded px-2 py-1" value={quickP} onChange={e => setQuickP(e.target.value)} />
                <input placeholder="C" type="number" className="text-sm bg-background border border-border rounded px-2 py-1" value={quickC} onChange={e => setQuickC(e.target.value)} />
                <input placeholder="F" type="number" className="text-sm bg-background border border-border rounded px-2 py-1" value={quickF} onChange={e => setQuickF(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="text-xs" onClick={handleQuickAdd} disabled={logging || !quickCal}>Add</Button>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowQuickAdd(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Empty slot — Add meal + Quick add + Skip side by side */}
          {!disabled && !skipped && !showPicker && !selectedPreset && !showCompose && !composedPortions && !showQuickAdd && meals.length === 0 && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground" onClick={() => setShowPicker(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add meal
              </Button>
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground" onClick={() => setShowQuickAdd(true)} disabled={disabled}>
                <Plus className="h-3 w-3" />
                Quick add
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={handleSkip} disabled={skipping}>
                Skip
              </Button>
            </div>
          )}

          {/* Has meals — Add meal + Quick add buttons */}
          {!disabled && !skipped && !showPicker && !selectedPreset && !showCompose && !composedPortions && !showQuickAdd && meals.length > 0 && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground" onClick={() => setShowPicker(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add meal
              </Button>
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground" onClick={() => setShowQuickAdd(true)} disabled={disabled}>
                <Plus className="h-3 w-3" />
                Quick add
              </Button>
            </div>
          )}

          {/* Preset picker */}
          {!disabled && showPicker && !selectedPreset && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Choose a preset
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCancel}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {filteredPresets.length > 0 ? (
                  filteredPresets.map((p) => (
                    <Button
                      key={p.id}
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => handleSelectPreset(p)}
                    >
                      {p.name}
                    </Button>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No presets available for this slot
                  </span>
                )}
              </div>
              {ingredients && ingredients.length > 0 && (
                <>
                  <div className="w-full border-t my-1.5" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 w-full"
                    onClick={() => {
                      setShowPicker(false);
                      setShowCompose(true);
                    }}
                  >
                    Compose custom meal...
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Selected preset: macro preview + multiplier + log */}
          {!disabled && selectedPreset && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {selectedPreset.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCancel}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Macro preview */}
              {previewMacros && (
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div>
                    <div className="font-bold tabular-nums">
                      {previewMacros.calories}
                    </div>
                    <div className="text-muted-foreground">kcal</div>
                  </div>
                  <div>
                    <div className="font-bold tabular-nums text-blue-500">
                      {previewMacros.protein}g
                    </div>
                    <div className="text-muted-foreground">protein</div>
                  </div>
                  <div>
                    <div className="font-bold tabular-nums text-amber-500">
                      {previewMacros.carbs}g
                    </div>
                    <div className="text-muted-foreground">carbs</div>
                  </div>
                  <div>
                    <div className="font-bold tabular-nums text-rose-500">
                      {previewMacros.fat}g
                    </div>
                    <div className="text-muted-foreground">fat</div>
                  </div>
                </div>
              )}

              {/* Multiplier slider */}
              <NumberInput
                value={multiplier}
                onChange={setMultiplier}
                min={0.5}
                max={2.0}
                step={0.05}
                suffix="x"
              />

              {/* Log + Customize + Cancel */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
                {ingredients && ingredients.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handleCustomizePreset}
                  >
                    Customize
                  </Button>
                )}
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleLog}
                  disabled={logging}
                >
                  {logging ? "Logging..." : "Log"}
                </Button>
              </div>
            </div>
          )}

          {/* Ingredient picker (compose step 1) */}
          {!disabled && showCompose && !composedPortions && (
            <IngredientPicker
              ingredients={(ingredients ?? []) as Ingredient[]}
              selected={selectedIngredients}
              onToggle={handleToggleIngredient}
              onDone={handleIngredientsDone}
              onCancel={handleComposeCancel}
            />
          )}

          {/* Compose meal view (compose step 2) */}
          {!disabled && composedPortions && (
            <ComposeMealView
              portions={composedPortions}
              ingredients={(ingredients ?? []) as Ingredient[]}
              budget={slotBudget ?? null}
              onLog={handleComposeLog}
              onCancel={handleComposeCancel}
              onEditIngredients={handleEditIngredients}
              logging={logging}
              onTotalsChange={onTotalsPreview ? (t) => onTotalsPreview(slot, t) : undefined}
            />
          )}

          {/* Save as preset prompt */}
          {showSavePrompt && (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <span className="text-xs text-muted-foreground">
                Save as preset for reuse?
              </span>
              <input
                type="text"
                placeholder="Preset name..."
                value={savePresetName}
                onChange={(e) => setSavePresetName(e.target.value)}
                className="w-full rounded-md border px-2 py-1.5 text-sm bg-background"
                autoFocus
              />
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="flex-1" onClick={handleDismissSave}>
                  Skip
                </Button>
                <Button size="sm" className="flex-1" disabled={saving || !savePresetName.trim()} onClick={handleSavePreset}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          )}

          {/* Meal detail modal */}
          <MealDetailModal
            open={detailMeal !== null}
            onClose={() => setDetailMeal(null)}
            meal={detailMeal}
            ingredients={(ingredients ?? []) as Ingredient[]}
            onEdit={detailMeal && !disabled ? () => {
              // Load meal into compose view for editing
              const itemsList: { ingredient_id: string; grams: number }[] =
                Array.isArray(detailMeal.items) ? detailMeal.items : (detailMeal.items?.items ?? []);
              const ids = new Set(itemsList.map((i) => i.ingredient_id));
              setSelectedIngredients(ids);
              // Create portions from the meal's items
              const ingLookup = new Map(
                ((ingredients ?? []) as Ingredient[]).map((i) => [i.id, i]),
              );
              const portions: PortionResult[] = itemsList
                .map((item) => {
                  const ing = ingLookup.get(item.ingredient_id);
                  if (!ing) return null;
                  const macros = computeItemMacros(ing, item.grams);
                  return {
                    ingredient_id: item.ingredient_id,
                    grams: item.grams,
                    increment: { protein: 25, carbs: 10, vegetable: 25, fat: 5, dairy: 25, sauce: 10, fruit: 25, supplement: 5 }[ing.category] ?? 10,
                    ...macros,
                  };
                })
                .filter((p): p is PortionResult => p !== null);
              setComposedPortions(portions);
              // Mark the old meal for deletion on successful save
              setEditingMealId(detailMeal.id);
              setDetailMeal(null);
            } : undefined}
          />
        </CardContent>
      )}
    </Card>
  );
}
