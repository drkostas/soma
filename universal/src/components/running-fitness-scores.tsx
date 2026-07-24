import { View } from "react-native";
import { Text, Card, Sparkline } from "soma-style";
import type { FitnessScores } from "../lib/api";

const ENDURANCE_CLASS: Record<number, string> = {
  1: "Novice", 2: "Trained", 3: "Well trained", 4: "Expert", 5: "Superior", 6: "Elite",
};

/** Endurance + hill fitness score cards, fed by /api/running/fitness-scores. */
export function RunningFitnessScores({ scores }: { scores: FitnessScores | null | undefined }) {
  if (!scores) return null;
  const end = scores.endurance.latest;
  const hill = scores.hill.latest;
  const endSeries = scores.endurance.trend.map((p) => p.score).filter((v): v is number => v != null);
  const hillSeries = scores.hill.trend.map((p) => p.score).filter((v): v is number => v != null);

  if (!end && !hill) return null;

  return (
    <View className="gap-4">
      {end ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Endurance score</Text>
            {end.classification != null ? (
              <Text variant="micro" className="text-text-muted">{ENDURANCE_CLASS[end.classification] ?? `class ${end.classification}`}</Text>
            ) : null}
          </View>
          <Text variant="display" className="text-teal">{end.score != null ? end.score.toLocaleString() : "—"}</Text>
          {endSeries.length >= 2 ? <Sparkline data={endSeries} color="#77c8d1" height={34} baseline /> : null}
        </Card>
      ) : null}

      {hill ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Hill score</Text>
          <View className="flex-row items-end gap-2">
            <Text variant="display" className="text-lime">{hill.score ?? "—"}</Text>
            <View className="mb-1 flex-row gap-3">
              {hill.strength != null ? <Text variant="micro" className="text-text-muted">strength {hill.strength}</Text> : null}
              {hill.endurance != null ? <Text variant="micro" className="text-text-muted">endurance {hill.endurance}</Text> : null}
            </View>
          </View>
          {hillSeries.length >= 2 ? <Sparkline data={hillSeries} color="#cbe896" height={34} baseline /> : null}
        </Card>
      ) : null}
    </View>
  );
}
