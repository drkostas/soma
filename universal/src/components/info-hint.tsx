import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text, Modal } from "soma-style";

/** Press-to-reveal "ⓘ" for a stat card, the phone form of web's StatCard hover tooltip
 *  (soma#758). Tapping opens a small sheet with the same text web shows; `trend`
 *  adds the trend-window sentence web keeps in the badge's title attribute. */
export function InfoHint({ title, text, trend, testID }: { title: string; text: string; trend?: string; testID?: string }) {
  const [open, setOpen] = useState(false);
  const id = testID ?? `info-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <>
      <Pressable
        onPress={(e) => { e.stopPropagation(); setOpen(true); }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`About ${title}`}
        testID={id}
        className="h-4 w-4 items-center justify-center rounded-full"
        style={{ borderWidth: 1, borderColor: "#3a5563" }}
      >
        <Text variant="micro" style={{ color: "#8fa8b8", fontSize: 9, lineHeight: 11, fontWeight: "700" }}>i</Text>
      </Pressable>
      <Modal visible={open} onClose={() => setOpen(false)} title={title}>
        <View className="gap-2" testID="info-sheet">
          <Text variant="body" className="text-text-secondary">{text}</Text>
          {trend ? <Text variant="micro" className="text-text-muted">Trend: {trend}</Text> : null}
        </View>
      </Modal>
    </>
  );
}

/** Web's stat-card tooltip texts, verbatim (web/app/page.tsx, web/app/sleep/page.tsx). */
export const STAT_INFO: Record<string, string> = {
  steps: "Daily step count from your Garmin watch",
  calories: "Calories burned above your BMR through activity",
  rhr: "Lower resting HR generally indicates better cardiovascular fitness. Elite athletes: 40-50 bpm",
  vo2max: "Maximum oxygen uptake. Higher is better. Excellent: 50+ ml/kg/min",
  sleep: "Total sleep time from Garmin sleep tracking. Recommended: 7-9 hours",
  stress: "Garmin stress score (0-100). Lower is better. 0-25 = Rest, 26-50 = Low, 51-75 = Medium, 76-100 = High",
  activities: "Total tracked activities across all sports in this period",
  avg_sleep: "Average total sleep time per night. Recommended: 7-9 hours",
  sleep_score: "Garmin sleep score (0-100) based on duration, quality, and restoration. 80+ = Excellent",
  deep_sleep: "Percentage of sleep in deep (slow-wave) stage. Ideal: 15-25%. Critical for physical recovery",
  sleep_hr: "Average heart rate during sleep. Lower values indicate better recovery and cardiovascular health",
};
export const TREND_7D = "7-day avg vs prior week";
export const TREND_7D_LOWER = "7-day avg vs prior week (lower is better)";
