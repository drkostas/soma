import { Tabs } from "expo-router";
import { Pressable, View, type ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatProvider, useChat } from "../../components/ChatContext";
import { ChatSheet } from "../../components/ChatSheet";

/* soma-style tokens (mirrored from soma-style/preset.js — the tab bar is native
   chrome so it reads them directly rather than via NativeWind classes). */
const TEAL = "#77c8d1";
const MUTED = "#5a7a8a";
const SURFACE = "#0e1a26";
const BORDER = "#1a3040";
const INK = "#0a1720";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} size={size} color={color as string} />
  );

/** Center ⊕ — opens the Claude chat as a quick log/ask action (not a route). */
function CenterLogButton() {
  const { openChat } = useChat();
  return (
    <View className="flex-1 items-center justify-center">
      <Pressable
        onPress={openChat}
        accessibilityLabel="Log or ask Claude"
        className="h-14 w-14 items-center justify-center rounded-full bg-teal"
        style={{ marginTop: -18, shadowColor: TEAL, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 }}
      >
        <Ionicons name="add" size={30} color={INK} />
      </Pressable>
    </View>
  );
}

function TabsNav() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TEAL,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: { backgroundColor: SURFACE, borderTopColor: BORDER, borderTopWidth: 1 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: "#0a1720" },
      }}
    >
      <Tabs.Screen name="overview" options={{ title: "Home", tabBarIcon: tabIcon("home-outline") }} />
      <Tabs.Screen name="training" options={{ title: "Training", tabBarIcon: tabIcon("barbell-outline") }} />
      <Tabs.Screen name="log" options={{ title: "", tabBarButton: () => <CenterLogButton /> }} />
      <Tabs.Screen name="nutrition" options={{ title: "Food", tabBarIcon: tabIcon("restaurant-outline") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: tabIcon("ellipsis-horizontal") }} />
      {/* Behind "More" — reachable from the More screen, hidden from the tab bar. */}
      <Tabs.Screen name="running" options={{ href: null }} />
      <Tabs.Screen name="activities" options={{ href: null }} />
      <Tabs.Screen name="workouts" options={{ href: null }} />
      <Tabs.Screen name="sleep" options={{ href: null }} />
      <Tabs.Screen name="playlist" options={{ href: null }} />
      <Tabs.Screen name="connections" options={{ href: null }} />
      <Tabs.Screen name="system" options={{ href: null }} />
    </Tabs>
  );
}

export default function MainLayout() {
  return (
    <ChatProvider>
      <SafeAreaView edges={["top"]} className="flex-1 bg-base">
        <TabsNav />
      </SafeAreaView>
      <ChatSheet />
    </ChatProvider>
  );
}
