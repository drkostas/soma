import { Slot, usePathname, useRouter } from "expo-router";
import { View } from "react-native";
import { NavBar } from "soma-style";

const ITEMS = [
  { key: "overview", label: "Overview" },
  { key: "nutrition", label: "Nutrition" },
  { key: "training", label: "Training" },
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
