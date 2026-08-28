import { View } from "react-native";
import { Text, Card } from "soma-style";
import { LineChart, ChartLegend, ExpandableChart, chartDateLabel } from "./line-chart";
import type { Respiratory } from "../lib/api";

function avg(vals: (number | null)[]): number | null {
  const nn = vals.filter((v): v is number => v != null && isFinite(v));
  return nn.length ? nn.reduce((a, b) => a + b, 0) / nn.length : null;
}
const fin = (v: number | null | undefined): number | null => (v != null && isFinite(Number(v)) ? Number(v) : null);

/** SpO2 (avg/sleep/low + 95% line) + respiration (sleep/awake) charts for the
 *  sleep screen, tap-to-read + expandable. Fed by /api/sleep/respiratory. */
export function SleepRespiratory({ data }: { data: Respiratory | null | undefined }) {
  if (!data) return null;
  const spo2 = data.spo2.latest;
  const resp = data.respiration.latest;
  const sTrend = data.spo2.trend;
  const rTrend = data.respiration.trend;
  const sLabels = sTrend.map((p) => chartDateLabel(p.date));
  const rLabels = rTrend.map((p) => chartDateLabel(p.date));
  const spo2Avg = avg(sTrend.slice(-7).map((p) => p.avg_spo2));
  const spo2HasChart = sTrend.filter((p) => p.avg_spo2 != null).length >= 2;
  const respAvg = avg(rTrend.slice(-7).map((p) => p.sleep_resp ?? p.awake_resp));
  const respHasChart = rTrend.filter((p) => (p.sleep_resp ?? p.awake_resp) != null).length >= 2;

  if (!spo2 && !resp) return null;
  const spo2Series = [
    { values: sTrend.map((p) => fin(p.low_spo2)), color: "#3a5563", width: 1.2, label: "Low" },
    { values: sTrend.map((p) => fin(p.sleep_spo2)), color: "#8b9df0", width: 1.4, dashed: true, label: "Sleep" },
    { values: sTrend.map((p) => fin(p.avg_spo2)), color: "#6aa0e0", width: 2.2, label: "Avg" },
  ];

  return (
    <View className="gap-4">
      {spo2 ? (
        <Card className="gap-2">
          <ExpandableChart
            title="Blood oxygen (SpO₂)"
            chart={{ series: spo2Series, refLine: { y: 95, color: "#3a5563" }, yFormat: (v) => `${Math.round(v)}%`, yMax: 100 }}
          >
            <View className="flex-row items-end gap-2">
              <Text variant="display" className="text-teal">{spo2.avg_spo2 != null ? Math.round(spo2.avg_spo2) : "—"}</Text>
              <Text variant="caption" className="text-text-muted mb-1">% avg</Text>
              {spo2Avg != null ? <Text variant="micro" className="text-text-muted mb-1">· 7d avg {Math.round(spo2Avg)}%</Text> : null}
              {spo2.low_spo2 != null ? <Text variant="micro" className="text-text-muted mb-1">· low {spo2.low_spo2}%</Text> : null}
            </View>
            {spo2HasChart ? (
              <LineChart height={120} interactive labels={sLabels} xTicks={4} yMax={100} refLine={{ y: 95, color: "#3a5563" }} yFormat={(v) => `${Math.round(v)}%`} series={spo2Series} />
            ) : null}
          </ExpandableChart>
          {spo2HasChart ? <ChartLegend items={[{ color: "#6aa0e0", label: "Avg" }, { color: "#8b9df0", label: "Sleep", dashed: true }, { color: "#3a5563", label: "95% ref", dashed: true }]} /> : null}
        </Card>
      ) : null}

      {resp ? (
        <Card className="gap-2">
          <ExpandableChart
            title="Respiration rate"
            chart={{ series: [{ values: rTrend.map((p) => fin(p.sleep_resp)), color: "#a5b4fc", width: 2.2 }, { values: rTrend.map((p) => fin(p.awake_resp)), color: "#77c8d1", width: 1.4, dashed: true }], yFormat: (v) => `${v.toFixed(0)}` }}
          >
            <View className="flex-row items-end gap-2">
              <Text variant="display" className="text-indigo">
                {resp.sleep_resp != null ? Math.round(resp.sleep_resp) : resp.awake_resp != null ? Math.round(resp.awake_resp) : "—"}
              </Text>
              <Text variant="caption" className="text-text-muted mb-1">br/min {resp.sleep_resp != null ? "sleeping" : "awake"}</Text>
              {respAvg != null ? <Text variant="micro" className="text-text-muted mb-1">· 7d avg {respAvg.toFixed(1)}</Text> : null}
            </View>
            {respHasChart ? (
              <LineChart height={110} interactive labels={rLabels} xTicks={4} yFormat={(v) => `${v.toFixed(0)}`} series={[{ values: rTrend.map((p) => fin(p.sleep_resp)), color: "#a5b4fc", width: 2.2, label: "Sleep" }, { values: rTrend.map((p) => fin(p.awake_resp)), color: "#77c8d1", width: 1.4, dashed: true, label: "Awake" }]} />
            ) : null}
          </ExpandableChart>
          {respHasChart ? <ChartLegend items={[{ color: "#a5b4fc", label: "Sleep" }, { color: "#77c8d1", label: "Awake", dashed: true }]} /> : null}
        </Card>
      ) : null}
    </View>
  );
}
