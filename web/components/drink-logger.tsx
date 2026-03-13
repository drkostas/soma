"use client";

import { useState, useMemo } from "react";
import { Beer, ChevronDown, ChevronUp, Minus, Plus, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ── Constants ─────────────────────────────────────────────────

const DRINK_OPTIONS = [
  { key: "beer_light", label: "Light Beer", cal: 103, defaultMl: 355 },
  { key: "beer_regular", label: "Lager", cal: 153, defaultMl: 355 },
  { key: "beer_ipa", label: "IPA", cal: 213, defaultMl: 355 },
  { key: "beer_craft", label: "Craft", cal: 260, defaultMl: 355 },
  { key: "wine_red", label: "Red Wine", cal: 128, defaultMl: 150 },
  { key: "wine_white", label: "White Wine", cal: 123, defaultMl: 150 },
  { key: "spirit", label: "Spirit", cal: 97, defaultMl: 44 },
  { key: "margarita", label: "Margarita", cal: 264, defaultMl: 240 },
  { key: "old_fashioned", label: "Old Fashioned", cal: 168, defaultMl: 120 },
] as const;

// ── Types ─────────────────────────────────────────────────────

interface Drink {
  id: number;
  date: string;
  drink_type: string;
  name: string;
  quantity: number;
  quantity_ml: number;
  calories: number;
  carbs: number;
  alcohol_grams: number;
  fat_oxidation_pause_hours: number;
  logged_at: string;
}

interface DrinkLoggerProps {
  drinks: Drink[];
  date: string;
  disabled: boolean;
  onDrinkLogged: () => void;
}

// ── Component ─────────────────────────────────────────────────

export function DrinkLogger({
  drinks,
  date,
  disabled,
  onDrinkLogged,
}: DrinkLoggerProps) {
  const [expanded, setExpanded] = useState(drinks.length > 0);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedDrink, setSelectedDrink] = useState<
    (typeof DRINK_OPTIONS)[number] | null
  >(null);
  const [quantity, setQuantity] = useState(1);
  const [logging, setLogging] = useState(false);

  const totalCal = drinks.reduce((s, d) => s + Number(d.calories || 0), 0);

  const previewCal = useMemo(() => {
    if (!selectedDrink) return 0;
    return Math.round(selectedDrink.cal * quantity);
  }, [selectedDrink, quantity]);

  const handleSelectDrink = (drink: (typeof DRINK_OPTIONS)[number]) => {
    setSelectedDrink(drink);
    setQuantity(1);
  };

  const handleLog = async () => {
    if (!selectedDrink) return;
    setLogging(true);
    try {
      const res = await fetch("/api/nutrition/log-drink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          drink_type: selectedDrink.key,
          quantity,
        }),
      });
      if (res.ok) {
        setSelectedDrink(null);
        setShowPicker(false);
        setQuantity(1);
        onDrinkLogged();
      }
    } finally {
      setLogging(false);
    }
  };

  const handleCancel = () => {
    setSelectedDrink(null);
    setShowPicker(false);
    setQuantity(1);
  };

  return (
    <Card>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Beer className="h-4 w-4" />
          <span className="font-medium text-sm">Drinks</span>
          {drinks.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({drinks.length})
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
          {/* Logged drinks */}
          {drinks.map((drink) => (
            <div
              key={drink.id}
              className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{drink.name}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(drink.calories)} kcal &middot;{" "}
                  {Number(drink.quantity_ml).toFixed(0)}ml
                  {Number(drink.alcohol_grams) > 0 && (
                    <> &middot; {Number(drink.alcohol_grams).toFixed(1)}g alcohol</>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Drink picker or add button */}
          {!disabled && !showPicker && !selectedDrink && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => setShowPicker(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add drink
            </Button>
          )}

          {/* Drink type picker */}
          {!disabled && showPicker && !selectedDrink && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Choose a drink
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
                {DRINK_OPTIONS.map((d) => (
                  <Button
                    key={d.key}
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => handleSelectDrink(d)}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Selected drink: quantity + preview + log */}
          {!disabled && selectedDrink && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {selectedDrink.label}
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

              {/* Quantity controls */}
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="text-lg font-bold tabular-nums w-8 text-center">
                  {quantity}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setQuantity(quantity + 1)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Calorie preview */}
              <div className="text-center text-sm text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">
                  {previewCal}
                </span>{" "}
                kcal
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
        </CardContent>
      )}
    </Card>
  );
}
