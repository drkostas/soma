import { ScrollView, Pressable, View } from "react-native";
import { Text } from "soma-style";
import { RANGES } from "../lib/time-range";

/** Horizontal-scrolling 10-range picker, mirroring the web TimeRangeSelector.
 *  Replaces the per-screen 3–4-range SegmentedControls. */
export function TimeRangeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-1.5 py-0.5 pr-4"
    >
      {RANGES.map((r) => {
        const active = value === r.value;
        return (
          <Pressable key={r.value} onPress={() => onChange(r.value)} hitSlop={4} accessibilityRole="button" accessibilityLabel={r.label}>
            <View
              className="rounded-full px-3 py-1.5"
              style={{ backgroundColor: active ? "#77c8d1" : "#152232", borderWidth: 1, borderColor: active ? "#77c8d1" : "#1a3040" }}
            >
              <Text variant="caption" style={{ color: active ? "#0a1720" : "#a0b4c0", fontWeight: active ? "700" : "500" }}>{r.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
