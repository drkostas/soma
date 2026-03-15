"use client";

import { useState, useMemo } from "react";
import { Trash2, Plus, ChevronDown, ChevronUp, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IngredientPicker } from "@/components/ingredient-picker";
import { ComposeMealView } from "@/components/compose-meal-view";
import { type Ingredient, type PortionResult, solvePortions } from "@/lib/portion-solver";

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

const MULTIPLIER_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const;

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
  onMealLogged: () => void;
  onSlotSkipped?: () => void;
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
        onMealLogged();
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
        onMealLogged();
      }
    } finally {
      setDeleting(null);
    }
  };

  const handleCancel = () => {
    setSelectedPreset(null);
    setShowPicker(false);
    setMultiplier(1);
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
        onMealLogged();
        setShowSavePrompt(true);
      }
    } finally {
      setLogging(false);
    }
  };

  const handleSavePreset = async () => {
    if (!savePresetName.trim() || !lastComposedItems) return;
    setSaving(true);
    try {
      await fetch("/api/nutrition/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: savePresetName.trim(),
          items: lastComposedItems,
          slot,
          totals: lastComposedTotals,
        }),
      });
      setShowSavePrompt(false);
      setSavePresetName("");
      setLastComposedItems(null);
      setLastComposedTotals(null);
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

  const handleComposeCancel = () => {
    setComposedPortions(null);
    setSelectedIngredients(new Set());
    setShowCompose(false);
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
          {meals.map((meal) => (
            <div
              key={meal.id}
              className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {meal.preset_name || "Custom meal"}
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
                </div>
              </div>
              {!disabled && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => handleDelete(meal.id)}
                  disabled={deleting === meal.id}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          ))}

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

          {/* Empty slot — Add meal + Skip side by side */}
          {!disabled && !skipped && !showPicker && !selectedPreset && !showCompose && !composedPortions && meals.length === 0 && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground" onClick={() => setShowPicker(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add meal
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={handleSkip} disabled={skipping}>
                Skip
              </Button>
            </div>
          )}

          {/* Has meals — just Add meal button */}
          {!disabled && !skipped && !showPicker && !selectedPreset && !showCompose && !composedPortions && meals.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setShowPicker(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add meal
            </Button>
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

              {/* Multiplier buttons */}
              <div className="flex items-center justify-center gap-1.5">
                {MULTIPLIER_OPTIONS.map((m) => (
                  <Button
                    key={m}
                    variant={multiplier === m ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs px-2.5"
                    onClick={() => setMultiplier(m)}
                  >
                    {m}x
                  </Button>
                ))}
              </div>

              {/* Log + Cancel */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
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
              logging={logging}
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
        </CardContent>
      )}
    </Card>
  );
}
