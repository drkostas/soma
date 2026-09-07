import { ScrollView, Pressable, View } from "react-native";
import { Text } from "soma-style";

/** Horizontal pill tab strip: six tabs never wrap, a tab can be shown disabled like web
 *  keeps "Splits" visible without laps (soma#760, shared with the workout modal in #761). */
export function TabStrip({ tabs, value, onChange }: { tabs: { key: string; disabled?: boolean }[]; value: string; onChange: (k: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1 py-0.5 pr-2">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <Pressable key={t.key} disabled={t.disabled} onPress={() => onChange(t.key)} hitSlop={4} accessibilityRole="tab" accessibilityState={{ selected: active, disabled: !!t.disabled }} testID={`tab-${t.key.toLowerCase()}`}>
            <View className="rounded-full px-2 py-1" style={{ backgroundColor: active ? "#77c8d1" : "#152232", borderWidth: 1, borderColor: active ? "#77c8d1" : "#1a3040", opacity: t.disabled ? 0.4 : 1 }}>
              <Text variant="micro" style={{ color: active ? "#0a1720" : "#a0b4c0", fontWeight: active ? "700" : "500", fontSize: 11.5, lineHeight: 15 }}>{t.key}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
