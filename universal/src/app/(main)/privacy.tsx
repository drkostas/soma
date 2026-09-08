import { ScrollView, View, Pressable, Linking } from "react-native";
import { Text, Card } from "soma-style";

/** Web's /privacy page (soma#796), same wording, as sections the More tab can reach. */
const SECTIONS: { title: string; body?: string; items?: string[] }[] = [
  {
    title: "Overview",
    body: "Soma Health (\"we\", \"us\", \"our\") is a personal health intelligence platform that integrates data from wearable devices and fitness services to provide nutrition tracking, training plan management, and body composition analysis.",
  },
  {
    title: "Data we collect",
    items: [
      "Garmin Connect data: activity summaries, daily health metrics (heart rate, sleep, steps, stress), body composition, and workout data synced from your Garmin wearable device.",
      "Hevy data: strength training workout data including exercises, sets, reps, and duration.",
      "Strava data: activity data synced for cross-platform tracking.",
      "User-entered data: nutrition logs, meal plans, body measurements, and profile information.",
    ],
  },
  {
    title: "How we use your data",
    items: [
      "Calculate daily energy expenditure and calorie targets",
      "Generate and manage training plans",
      "Track body composition progress toward goals",
      "Provide sleep-adjusted nutrition recommendations",
      "Sync structured workouts to your Garmin device",
    ],
  },
  {
    title: "Data storage and security",
    body: "Your data is stored securely in a Neon PostgreSQL database. We use HTTPS for all data transmission. Authentication is handled via GitHub OAuth with NextAuth.js on the web and a personal API token in this app. We do not sell, share, or distribute your personal data to any third parties.",
  },
  {
    title: "Third-party services",
    body: "We integrate with Garmin Connect, Hevy, and Strava to sync your fitness data. Each service has its own privacy policy. We only access data you explicitly authorize through OAuth consent flows.",
  },
  {
    title: "Data retention",
    body: "Your data is retained as long as your account is active. You may request deletion of your data at any time by contacting us.",
  },
  {
    title: "Your rights",
    items: [
      "Access your personal data",
      "Request correction of inaccurate data",
      "Request deletion of your data",
      "Revoke access to connected services at any time",
    ],
  },
];

const CONTACT = "kostas@gkos.dev";

export default function PrivacyScreen() {
  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="gap-1">
          <Text variant="headline" testID="privacy-title">Privacy policy</Text>
          <Text variant="caption" className="text-text-secondary">Last updated: March 17, 2026</Text>
        </View>
        {SECTIONS.map((s) => (
          <Card key={s.title} className="gap-2">
            <Text variant="eyebrow">{s.title}</Text>
            {s.body ? <Text variant="caption" className="text-text-secondary">{s.body}</Text> : null}
            {s.items ? (
              <View className="gap-1.5">
                {s.items.map((it) => (
                  <View key={it} className="flex-row gap-2">
                    <Text variant="caption" className="text-text-muted">•</Text>
                    <Text variant="caption" className="text-text-secondary flex-1">{it}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ))}
        <Card className="gap-2">
          <Text variant="eyebrow">Contact</Text>
          <Text variant="caption" className="text-text-secondary">For privacy inquiries, contact us at</Text>
          <Pressable onPress={() => Linking.openURL(`mailto:${CONTACT}`).catch(() => {})} accessibilityRole="link" testID="privacy-contact">
            <Text variant="caption" className="text-teal">{CONTACT}</Text>
          </Pressable>
        </Card>
      </View>
    </ScrollView>
  );
}
