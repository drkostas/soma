import { ScrollView, View } from "react-native";
import { Text, Card, Badge, ProgressBar } from "soma-style";
import { useTraining } from "../../lib/api";

/** Today (local), YYYY-MM-DD — training data is computed daily by the Garmin cron. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TL_TONE: Record<string, "success" | "warm" | "danger" | "teal"> = {
  green: "success",
  amber: "warm",
  yellow: "warm",
  red: "danger",
};

/** TSB (form) runs roughly −30..+30; map to a 0..1 bar centred on 0. */
const tsbPct = (tsb: number) => Math.max(0, Math.min(1, (tsb + 30) / 60));

export default function TrainingScreen() {
  const { data, error } = useTraining(todayISO());
  const pmc = data?.pmc;
  const fit = data?.fitness;
  const readiness = data?.readiness;

  const tsb = pmc?.tsb ?? 0;
  const load = [
    { label: "Fitness (CTL)", value: pmc?.ctl, color: "#77c8d1", pct: (pmc?.ctl ?? 0) / 100 },
    { label: "Fatigue (ATL)", value: pmc?.atl, color: "#e0a458", pct: (pmc?.atl ?? 0) / 100 },
    { label: "Form (TSB)", value: pmc?.tsb, color: tsb >= 0 ? "#6ad4a0" : "#e06060", pct: tsbPct(tsb) },
  ];

  const zRows = [
    { label: "Resting HR", z: readiness?.rhr_z_score },
    { label: "HRV", z: readiness?.hrv_z_score },
    { label: "Sleep", z: readiness?.sleep_z_score },
    { label: "Body Battery", z: readiness?.body_battery_z_score },
  ].filter((r) => r.z != null);

  const fmt = (v: number | null | undefined, unit = "", dp = 1) =>
    v == null ? "—" : `${v.toFixed(dp)}${unit}`;

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center gap-2">
          <Text variant="headline">Training</Text>
          {readiness ? (
            <Badge
              label={`Readiness ${readiness.traffic_light}`}
              tone={TL_TONE[readiness.traffic_light] ?? "teal"}
            />
          ) : null}
        </View>

        {error ? (
          <Card><Text variant="body" className="text-danger">API: {error} — is soma running on :3456?</Text></Card>
        ) : null}

        <Card className="gap-3">
          <Text variant="eyebrow">Training load (PMC)</Text>
          {load.map((l) => (
            <View key={l.label} className="gap-1">
              <View className="flex-row justify-between">
                <Text variant="caption" className="text-text-secondary">{l.label}</Text>
                <Text variant="caption" className="tabular-nums text-text">
                  {l.value == null ? "…" : l.value.toFixed(1)}
                </Text>
              </View>
              <ProgressBar pct={l.pct} color={l.color} />
            </View>
          ))}
          <Text variant="micro">
            {tsb >= 0 ? "Positive form — fresh and race-ready." : "Negative form — carrying fatigue."}
          </Text>
        </Card>

        <View className="flex-row gap-3">
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">VO2max</Text>
            <Text variant="headline" className="text-teal">{fmt(fit?.vo2max, "", 1)}</Text>
            <Text variant="micro">ml/kg/min</Text>
          </Card>
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">Drift</Text>
            <Text variant="headline" className="text-lime">{fmt(fit?.decoupling_pct, "%", 1)}</Text>
            <Text variant="micro">aerobic decoupling</Text>
          </Card>
          <Card className="flex-1 gap-1">
            <Text variant="eyebrow">Weight</Text>
            <Text variant="headline" className="text-warm">{fmt(fit?.weight_kg, "", 1)}</Text>
            <Text variant="micro">kg</Text>
          </Card>
        </View>

        {readiness ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">Readiness signals</Text>
              <Text variant="caption" className="tabular-nums text-text-muted">
                composite {fmt(readiness.composite_score, "", 2)}
              </Text>
            </View>
            {zRows.length ? (
              zRows.map((r) => (
                <View key={r.label} className="flex-row items-center justify-between border-b border-border-subtle py-2">
                  <Text variant="body" className="text-text-secondary">{r.label}</Text>
                  <Text
                    variant="body"
                    className={`tabular-nums ${(r.z ?? 0) >= 0 ? "text-success" : "text-warning"}`}
                  >
                    {(r.z ?? 0) >= 0 ? "+" : ""}{(r.z ?? 0).toFixed(2)} z
                  </Text>
                </View>
              ))
            ) : (
              <Text variant="micro">No baseline z-scores yet (needs ~14 days of history).</Text>
            )}
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}
