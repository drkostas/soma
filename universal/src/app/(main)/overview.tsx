import { View } from "react-native";
import { Text, Card } from "soma-style";
export default function overviewScreen() {
  return (
    <View className="flex-1 bg-base items-center px-5 py-6">
      <Card className="w-full max-w-2xl"><Text variant="title" className="capitalize">overview</Text></Card>
    </View>
  );
}
