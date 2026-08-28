import { useState } from "react";
import { View, Switch } from "react-native";
import { Text, Card, Badge } from "soma-style";

const PREFS: { key: string; label: string }[] = [
  { key: "workout_synced", label: "Workout synced to Garmin" },
  { key: "daily_summary", label: "Daily training summary" },
  { key: "new_pr", label: "New personal record" },
  { key: "kite_session", label: "Kite session processed" },
  { key: "sync_error", label: "Sync errors" },
];

/**
 * Push notification preferences (web parity, #446): a master enable toggle +
 * per-event preference switches. The actual device registration (Expo push
 * token) is a documented native trim; this manages the preference set.
 */
export function PushNotificationsCard() {
  const [enabled, setEnabled] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>(
    Object.fromEntries(PREFS.map((p) => [p.key, true])),
  );
  const toggle = (k: string) => setPrefs((m) => ({ ...m, [k]: !m[k] }));

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Push notifications</Text>
        <Badge label={enabled ? "On" : "Off"} tone={enabled ? "success" : "neutral"} />
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text variant="body" className="text-text">Enable notifications</Text>
          <Text variant="micro" className="text-text-muted">Get alerts on this device</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ false: "#2a3843", true: "#2f6d5b" }}
          thumbColor={enabled ? "#77c8d1" : "#8aa0ac"}
        />
      </View>

      <View className="gap-2 border-t border-border-subtle pt-2">
        {PREFS.map((p) => (
          <View key={p.key} className="flex-row items-center justify-between">
            <Text variant="body" className={enabled ? "text-text-secondary" : "text-text-muted"}>{p.label}</Text>
            <Switch
              value={enabled && prefs[p.key]}
              onValueChange={() => toggle(p.key)}
              disabled={!enabled}
              trackColor={{ false: "#2a3843", true: "#2f6d5b" }}
              thumbColor={enabled && prefs[p.key] ? "#6ad4a0" : "#8aa0ac"}
            />
          </View>
        ))}
      </View>
    </Card>
  );
}
