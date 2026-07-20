import { Tabs } from "expo-router";
import { type ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { tabBarScreenOptions, CenterTabButton } from "soma-style";
import { ChatProvider, useChat } from "../../components/ChatContext";
import { ChatSheet } from "../../components/ChatSheet";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} size={size} color={color as string} />
  );

/** Center ⊕ — opens the Claude chat as a quick log/ask action (not a route).
    Uses the shared soma-style CenterTabButton, wired to the chat context. */
function CenterLogButton() {
  const { openChat } = useChat();
  return <CenterTabButton onPress={openChat} accessibilityLabel="Log or ask Claude" />;
}

function TabsNav() {
  return (
    <Tabs screenOptions={tabBarScreenOptions}>
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
