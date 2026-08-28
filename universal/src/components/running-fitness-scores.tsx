import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ChartLegend, chartDateLabel } from "./line-chart";
import type { FitnessScores } from "../lib/api";

const ENDURANCE_CLASS: Record<number, string> = {
  1: "Novice", 2: "Trained", 3: "Well trained", 4: "Expert", 5: "Superior", 6: "Elite",
};

/** Endurance + hill fitness scores as one dual-axis chart (endurance left,
 *  hill right), tap-to-read. Web parity — fed by /api/running/fitness-scores. */
export function RunningFitnessScores({ scores }: { scores: FitnessScores | null | undefined }) {
  if (!scores) return null;
  const end = scores.endurance.latest;
  const hill = scores.hill.latest;
  if (!end && !hill) return null;

  // Align both series on the endurance date axis (hill looked up by date).
  const dates = scores.endurance.trend.map((p) => p.date);
  const hillByDate = new Map(scores.hill.trend.map((p) => [p.date, p.score]));
  const endVals = scores.endurance.trend.map((p) => (p.score != null && isFinite(p.score) ? p.score : null));
  const hillVals = dates.map((d) => { const v = hillByDate.get(d); return v != null && isFinite(v) ? v : null; });
  const hasChart = endVals.filter((v) => v != null).length >= 2 || hillVals.filter((v) => v != null).length >= 2;

  return (
    <Card className="gap-2">
      <Text variant="eyebrow">Fitness scores</Text>
      <View className="flex-row flex-wrap gap-x-6 gap-y-1">
        {end ? (
          <View className="gap-0.5">
            <Text variant="micro" className="text-text-muted">Endurance{end.classification != null ? ` · ${ENDURANCE_CLASS[end.classification] ?? end.classification}` : ""}</Text>
            <Text variant="title" className="text-teal">{end.score != null ? end.score.toLocaleString() : "—"}</Text>
          </View>
        ) : null}
        {hill ? (
          <View className="gap-0.5">
            <Text variant="micro" className="text-text-muted">Hill{hill.strength != null ? ` · str ${hill.strength}` : ""}{hill.endurance != null ? ` · end ${hill.endurance}` : ""}</Text>
            <Text variant="title" className="text-lime">{hill.score ?? "—"}</Text>
          </View>
        ) : null}
      </View>
      {hasChart ? (
        <>
          <LineChart
            height={150}
            interactive
            labels={dates.map((d) => chartDateLabel(d))}
            xTicks={4}
            yFormat={(v) => String(Math.round(v))}
            yFormatRight={(v) => String(Math.round(v))}
            series={[
              { values: endVals, color: "#77c8d1", width: 2.2, label: "Endurance" },
              { values: hillVals, color: "#cbe896", width: 2.2, axis: "right", label: "Hill" },
            ]}
          />
          <ChartLegend items={[{ color: "#77c8d1", label: "Endurance (L)" }, { color: "#cbe896", label: "Hill (R)" }]} />
        </>
      ) : null}
    </Card>
  );
}
