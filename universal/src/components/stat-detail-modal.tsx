import { View } from "react-native";
import { Text, Modal } from "soma-style";
import { LineChart } from "./line-chart";

export interface StatDetail {
  label: string;
  value: string;
  sub: string;
  spark?: number[];
  color: string;
  /** Optional unit suffix for the axis labels (e.g. "bpm", "kcal"). */
  unit?: string;
}

/** Detail dialog for an overview stat card: the current value + a full trend
 *  chart (upgraded from the card's sparkline) with min / avg / max. */
export function StatDetailModal({ stat, onClose }: { stat: StatDetail | null; onClose: () => void }) {
  if (!stat) return null;
  const s = (stat.spark ?? []).filter((v) => isFinite(v));
  const min = s.length ? Math.min(...s) : null;
  const max = s.length ? Math.max(...s) : null;
  const avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
  const fmt = (v: number | null) => (v == null ? "–" : `${Math.round(v).toLocaleString()}${stat.unit ? ` ${stat.unit}` : ""}`);
  return (
    <Modal visible={!!stat} onClose={onClose} title={stat.label}>
      <View className="gap-3">
        <View className="flex-row items-end gap-2">
          <Text variant="display" className="tabular-nums" style={{ color: stat.color }}>{stat.value}</Text>
          <Text variant="body" className="mb-1 text-text-muted">{stat.sub}</Text>
        </View>
        {s.length >= 2 ? (
          <View className="gap-1">
            <Text variant="eyebrow" className="text-text-muted">Trend · last {s.length} days</Text>
            <LineChart
              height={160}
              series={[{ values: s, color: stat.color, width: 2.2 }]}
              yFormat={(v) => `${Math.round(v).toLocaleString()}`}
            />
            <View className="mt-1 flex-row justify-between">
              <Text variant="micro" className="text-text-muted tabular-nums">min {fmt(min)}</Text>
              <Text variant="micro" className="text-text-muted tabular-nums">avg {fmt(avg)}</Text>
              <Text variant="micro" className="text-text-muted tabular-nums">max {fmt(max)}</Text>
            </View>
          </View>
        ) : (
          <Text variant="caption" className="text-text-muted">No trend data yet.</Text>
        )}
      </View>
    </Modal>
  );
}
