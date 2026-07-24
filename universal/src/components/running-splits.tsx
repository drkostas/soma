import { View } from "react-native";
import { Text, Card } from "soma-style";
import type { RunningSplits } from "../lib/api";

/** Decimal minutes → "M:SS". */
function pace(mins: number | null | undefined): string {
  if (mins == null || !isFinite(mins)) return "—";
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
const MEDAL = ["#e0c458", "#c0c0c8", "#b17850"]; // gold / silver / bronze

/** Per-km pace bars + fastest single-km splits, fed by /api/running/splits. */
export function RunningSplits({ data }: { data: RunningSplits | null | undefined }) {
  if (!data) return null;
  const perKm = data.perKm.filter((k) => k.avg_pace != null);
  const paces = perKm.map((k) => Number(k.avg_pace));
  const minP = Math.min(...paces);
  const maxP = Math.max(...paces);
  const rangeP = maxP - minP || 1;

  return (
    <View className="gap-4">
      {perKm.length >= 2 ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Average pace by km</Text>
          {perKm.map((k) => {
            const p = Number(k.avg_pace);
            const t = (p - minP) / rangeP; // 0 fastest → 1 slowest
            const color = t < 0.4 ? "#6ad4a0" : t < 0.7 ? "#e0c458" : "#e0a458";
            return (
              <View key={k.km} className="flex-row items-center gap-2 py-1">
                <Text variant="micro" className="tabular-nums text-text-muted w-8">km{k.km}</Text>
                <View className="flex-1 h-3 rounded-full bg-surface-subtle overflow-hidden">
                  <View className="h-full rounded-full" style={{ width: `${Math.max(6, (1 - t) * 100)}%`, backgroundColor: color }} />
                </View>
                <Text variant="caption" className="tabular-nums text-text w-16 text-right">{pace(p)}/km</Text>
              </View>
            );
          })}
          <Text variant="micro" className="text-text-muted">avg over ≥10 runs per km</Text>
        </Card>
      ) : null}

      {data.best.length ? (
        <Card className="gap-2">
          <Text variant="eyebrow">Fastest km splits</Text>
          {data.best.map((b, i) => (
            <View key={`${b.date}-${b.km}`} className="flex-row items-center gap-3 border-b border-border-subtle py-2">
              <View className="h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: (MEDAL[i] ?? "#2f4a58") + "33" }}>
                <Text variant="micro" style={{ color: MEDAL[i] ?? "#8aa0ac" }}>{i + 1}</Text>
              </View>
              <View className="flex-1">
                <Text variant="body" className="text-text" numberOfLines={1}>{b.activity_name || `km ${b.km}`}</Text>
                <Text variant="micro" className="text-text-muted">km{b.km} · {shortDate(b.date)}</Text>
              </View>
              <Text variant="body" className="tabular-nums text-teal">{pace(b.pace)}/km</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
