import { Slot, usePathname, useRouter } from "expo-router";
import { View } from "react-native";
import { NavBar } from "soma-style";

const ITEMS = [
  { key: "overview", label: "Overview" },
  { key: "training", label: "Training" },
  { key: "running", label: "Running" },
  { key: "workouts", label: "Workouts" },
  { key: "activities", label: "Activities" },
  { key: "sleep", label: "Sleep" },
  { key: "nutrition", label: "Nutrition" },
  { key: "playlist", label: "Playlist" },
  { key: "connections", label: "Sync" },
  { key: "status", label: "Status" },
];

export default function MainLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const active = ITEMS.find((i) => pathname.startsWith(`/${i.key}`))?.key ?? "nutrition";
  return (
    <View className="flex-1 bg-base">
      <NavBar brand="soma" items={ITEMS} active={active} onSelect={(k) => router.push(`/${k}` as never)} />
      <Slot />
    </View>
  );
}
