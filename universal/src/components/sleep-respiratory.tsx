import { View, Pressable } from "react-native";
import { Text, Card, Sparkline } from "soma-style";
import type { Respiratory } from "../lib/api";
import type { StatDetail } from "./stat-detail-modal";

function avg(vals: (number | null)[]): number | null {
  const nn = vals.filter((v): v is number => v != null && isFinite(v));
  return nn.length ? nn.reduce((a, b) => a + b, 0) / nn.length : null;
}

/** SpO2 + respiration cards for the sleep screen, fed by /api/sleep/respiratory. */
export function SleepRespiratory({
  data,
  onExpand,
}: {
  data: Respiratory | null | undefined;
  onExpand?: (s: StatDetail) => void;
}) {
  if (!data) return null;
  const spo2 = data.spo2.latest;
  const resp = data.respiration.latest;
  const spo2Series = data.spo2.trend.map((p) => p.avg_spo2).filter((v): v is number => v != null);
  const respSeries = data.respiration.trend.map((p) => p.sleep_resp ?? p.awake_resp).filter((v): v is number => v != null);
  const spo2Avg = avg(data.spo2.trend.slice(-7).map((p) => p.avg_spo2));
  const spo2Tappable = !!(onExpand && spo2Series.length >= 2);
  const respTappable = !!(onExpand && respSeries.length >= 2);

  if (!spo2 && !resp) return null;

  return (
    <View className="gap-4">
      {spo2 ? (
        <Pressable
          disabled={!spo2Tappable}
          onPress={() =>
            onExpand?.({
              label: "Blood oxygen (SpO₂)",
              value: spo2.avg_spo2 != null ? `${Math.round(spo2.avg_spo2)}%` : "—",
              sub: spo2.low_spo2 != null ? `low ${spo2.low_spo2}%` : "avg",
              spark: spo2Series,
              color: "#6aa0e0",
              unit: "%",
            })
          }
        >
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Blood oxygen (SpO₂)</Text>
              <View className="flex-row items-center gap-1.5">
                {spo2.low_spo2 != null ? <Text variant="micro" className="text-text-muted">low {spo2.low_spo2}%</Text> : null}
                {spo2Tappable ? <Text variant="micro" className="text-text-muted">›</Text> : null}
              </View>
            </View>
            <View className="flex-row items-end gap-2">
              <Text variant="display" className="text-teal">{spo2.avg_spo2 != null ? Math.round(spo2.avg_spo2) : "—"}</Text>
              <Text variant="caption" className="text-text-muted mb-1">% avg</Text>
              {spo2Avg != null ? <Text variant="micro" className="text-text-muted mb-1">· 7d avg {Math.round(spo2Avg)}%</Text> : null}
            </View>
            {spo2Series.length >= 2 ? <Sparkline data={spo2Series} color="#6aa0e0" height={34} baseline /> : null}
          </Card>
        </Pressable>
      ) : null}

      {resp ? (
        <Pressable
          disabled={!respTappable}
          onPress={() =>
            onExpand?.({
              label: "Respiration rate",
              value:
                resp.sleep_resp != null
                  ? `${Math.round(resp.sleep_resp)}`
                  : resp.awake_resp != null
                    ? `${Math.round(resp.awake_resp)}`
                    : "—",
              sub: `br/min ${resp.sleep_resp != null ? "sleeping" : "awake"}`,
              spark: respSeries,
              color: "#a5b4fc",
              unit: "br/min",
            })
          }
        >
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Respiration rate</Text>
              {respTappable ? <Text variant="micro" className="text-text-muted">›</Text> : null}
            </View>
            <View className="flex-row items-end gap-2">
              <Text variant="display" className="text-indigo">
                {resp.sleep_resp != null ? Math.round(resp.sleep_resp) : resp.awake_resp != null ? Math.round(resp.awake_resp) : "—"}
              </Text>
              <Text variant="caption" className="text-text-muted mb-1">br/min {resp.sleep_resp != null ? "sleeping" : "awake"}</Text>
            </View>
            <View className="flex-row flex-wrap gap-x-5 gap-y-1">
              {resp.awake_resp != null ? <Text variant="micro" className="text-text-secondary">Awake {Math.round(resp.awake_resp)}</Text> : null}
              {resp.low_resp != null ? <Text variant="micro" className="text-text-secondary">Low {Math.round(resp.low_resp)}</Text> : null}
              {resp.high_resp != null ? <Text variant="micro" className="text-text-secondary">High {Math.round(resp.high_resp)}</Text> : null}
            </View>
            {respSeries.length >= 2 ? <Sparkline data={respSeries} color="#a5b4fc" height={34} baseline /> : null}
          </Card>
        </Pressable>
      ) : null}
    </View>
  );
}
