import { View } from "react-native";
import { Text, Modal, Button, Badge } from "soma-style";
import type { SomaMeal } from "../lib/api";

const MACRO_ROWS: { key: "protein" | "carbs" | "fat" | "fiber"; label: string }[] = [
  { key: "protein", label: "Protein" }, { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" }, { key: "fiber", label: "Fiber" },
];

/** Detail view for a logged meal: macros + ingredient breakdown, with Delete
 *  and (for composed meals) Edit. Tapping a meal row opens this. */
export function MealDetailModal({
  meal, name, slotLabel, onClose, onDelete, onEdit, deleting,
}: {
  meal: SomaMeal | null;
  name: string;
  slotLabel: (s: string) => string;
  onClose: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  deleting?: boolean;
}) {
  if (!meal) return null;
  const canEdit = meal.source === "compose" && (meal.items?.some((i) => i.ingredient_id) ?? false);
  return (
    <Modal visible={!!meal} onClose={onClose} title="Meal details">
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <Badge label={slotLabel(meal.meal_slot)} tone="teal" />
          {meal.source ? <Badge label={meal.source} tone="neutral" /> : null}
        </View>
        <Text variant="title" numberOfLines={2}>{name}</Text>
        <Text variant="display" className="tabular-nums">{Math.round(meal.calories)} kcal</Text>
        <View className="flex-row flex-wrap gap-x-6 gap-y-1">
          {MACRO_ROWS.map((m) => (
            <View key={m.key}>
              <Text variant="micro" className="text-text-muted">{m.label}</Text>
              <Text variant="caption" className="tabular-nums">{Math.round(meal[m.key])}g</Text>
            </View>
          ))}
        </View>

        {meal.items?.length ? (
          <View className="gap-1 rounded-lg border border-border-subtle p-3">
            <Text variant="eyebrow" className="text-text-muted">Ingredients</Text>
            {meal.items.map((it, i) => (
              <View key={i} className="flex-row items-center justify-between border-b border-border-subtle py-1">
                <Text variant="caption" className="flex-1 text-text" numberOfLines={1}>{it.name ?? "Item"}</Text>
                <Text variant="micro" className="text-text-muted tabular-nums">
                  {it.grams ? `${Math.round(it.grams)} g` : ""}{it.calories ? ` · ${Math.round(it.calories)} kcal` : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View className="mt-1 flex-row items-center justify-end gap-2">
          <Button label="Close" variant="ghost" onPress={onClose} />
          {canEdit && onEdit ? <Button label="Edit" variant="secondary" onPress={onEdit} /> : null}
          <Button label={deleting ? "…" : "Delete"} variant="ghost" className="text-danger" disabled={deleting} onPress={onDelete} />
        </View>
      </View>
    </Modal>
  );
}
