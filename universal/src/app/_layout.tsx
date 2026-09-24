import "../global.css";
import { Stack } from "expo-router";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { hydrateRangePref } from "../lib/time-range";
import { applyStoredAuth } from "../lib/api";
// Imported for the side effect: the weight task must be defined before React renders, because
// Android can start the app headless purely to run it. See lib/weight-task.ts.
import { registerWeightSync } from "../lib/weight-task";

export default function RootLayout() {
  // Read the persisted time range once before any screen fetches with it (soma#754).
  const [ready, setReady] = useState(false);
  // Also apply stored sign-in credentials (soma#796) so no screen fetches with the wrong server.
  useEffect(() => { Promise.all([hydrateRangePref(), applyStoredAuth()]).finally(() => setReady(true)); }, []);
  // Registering is idempotent, so every launch is the right place to make sure it is armed.
  useEffect(() => { void registerWeightSync(); }, []);
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
