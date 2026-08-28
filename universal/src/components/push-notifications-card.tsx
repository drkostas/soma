import { useEffect, useState } from "react";
import { View, Switch } from "react-native";
import { Text, Card, Badge } from "soma-style";
import { getNotificationPrefs, setNotificationPrefs, type NotificationPrefs } from "../lib/api";

const PREFS: { key: keyof NotificationPrefs; label: string }[] = [
  { key: "on_sync_workout", label: "Workout synced to Garmin" },
  { key: "on_sync_run", label: "Run synced" },
  { key: "on_sync_error", label: "Sync errors" },
  { key: "on_milestone", label: "Milestones & personal records" },
  { key: "on_playlist_ready", label: "Playlist ready" },
];

const DEFAULTS: NotificationPrefs = {
  enabled: false, on_sync_workout: true, on_sync_run: true, on_sync_error: true, on_milestone: true, on_playlist_ready: false,
};

/**
 * Push notification preferences (web parity, #446): a master enable toggle +
 * per-event preference switches, persisted to /api/notifications/preferences
 * (GET on mount, PUT on change) with the server's real keys. The device push
 * token registration itself is a documented native trim.
 */
export function PushNotificationsCard() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getNotificationPrefs().then((p) => { if (alive && p) setPrefs({ ...DEFAULTS, ...p }); });
    return () => { alive = false; };
  }, []);

  async function update(next: NotificationPrefs) {
    setPrefs(next);
    setSaving(true);
    const ok = await setNotificationPrefs(next);
    setSaving(false);
    if (!ok) getNotificationPrefs().then((p) => p && setPrefs({ ...DEFAULTS, ...p })); // revert to server truth
  }
  const setEnabled = (v: boolean) => update({ ...prefs, enabled: v });
  const toggle = (k: keyof NotificationPrefs) => update({ ...prefs, [k]: !prefs[k] });

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="eyebrow">Push notifications</Text>
        <Badge label={saving ? "Saving…" : prefs.enabled ? "On" : "Off"} tone={prefs.enabled ? "success" : "neutral"} />
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text variant="body" className="text-text">Enable notifications</Text>
          <Text variant="micro" className="text-text-muted">Get alerts on this device</Text>
        </View>
        <Switch
          value={prefs.enabled}
          onValueChange={setEnabled}
          trackColor={{ false: "#2a3843", true: "#2f6d5b" }}
          thumbColor={prefs.enabled ? "#77c8d1" : "#8aa0ac"}
        />
      </View>

      <View className="gap-2 border-t border-border-subtle pt-2">
        {PREFS.map((p) => (
          <View key={p.key} className="flex-row items-center justify-between">
            <Text variant="body" className={prefs.enabled ? "text-text-secondary" : "text-text-muted"}>{p.label}</Text>
            <Switch
              value={prefs.enabled && prefs[p.key]}
              onValueChange={() => toggle(p.key)}
              disabled={!prefs.enabled}
              trackColor={{ false: "#2a3843", true: "#2f6d5b" }}
              thumbColor={prefs.enabled && prefs[p.key] ? "#6ad4a0" : "#8aa0ac"}
            />
          </View>
        ))}
      </View>
    </Card>
  );
}
