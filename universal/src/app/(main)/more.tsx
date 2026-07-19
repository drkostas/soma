import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "soma-style";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/* Secondary sections that don't fit the 4 primary tabs. Tapping pushes the route;
   the bottom tab bar stays visible (these are siblings in the same Tabs group). */
const SECTIONS: { key: string; label: string; hint: string; icon: IconName }[] = [
  { key: "running", label: "Running", hint: "Stats, HR zones, PRs, shoes", icon: "walk-outline" },
  { key: "activities", label: "Activities", hint: "Kiteboarding, snow, cycling & more", icon: "boat-outline" },
  { key: "workouts", label: "Workouts", hint: "Strength history + Garmin sync", icon: "barbell-outline" },
  { key: "sleep", label: "Sleep", hint: "Stages, HRV, respiration", icon: "moon-outline" },
  { key: "playlist", label: "Playlist", hint: "BPM-matched running playlists", icon: "musical-notes-outline" },
  { key: "connections", label: "Sync", hint: "Integrations & sync rules", icon: "sync-outline" },
  { key: "system", label: "Status", hint: "Pipeline & platform status", icon: "pulse-outline" },
];

export default function MoreScreen() {
  const router = useRouter();
  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="gap-1">
          <Text variant="headline">More</Text>
          <Text variant="caption" className="text-text-secondary">
            Everything beyond the main tabs
          </Text>
        </View>

        <View className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
          {SECTIONS.map((s, i) => (
            <Pressable
              key={s.key}
              onPress={() => router.push(`/${s.key}` as never)}
              accessibilityLabel={s.label}
              className="flex-row items-center gap-3 px-4 py-4 active:bg-surface-hover"
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: "#142530" } : undefined}
            >
              <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-elevated">
                <Ionicons name={s.icon} size={18} color="#77c8d1" />
              </View>
              <View className="flex-1 gap-0.5">
                <Text variant="body" className="text-text">
                  {s.label}
                </Text>
                <Text variant="micro" className="text-text-muted">
                  {s.hint}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#5a7a8a" />
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
