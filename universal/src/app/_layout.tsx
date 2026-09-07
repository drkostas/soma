import "../global.css";
import { Stack } from "expo-router";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { hydrateRangePref } from "../lib/time-range";

export default function RootLayout() {
  // Read the persisted time range once before any screen fetches with it (soma#754).
  const [ready, setReady] = useState(false);
  useEffect(() => { hydrateRangePref().finally(() => setReady(true)); }, []);
  if (!ready) return <View className="flex-1 bg-base" />;
  return (
    <SafeAreaProvider>
      <View className="flex-1 bg-base">
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0a1720" } }} />
      </View>
    </SafeAreaProvider>
  );
}
