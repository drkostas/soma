import { View } from "react-native";
import { Text, Card, Badge } from "soma-style";

export interface FlowPlatform { key: string; label: string; connected: boolean }
export interface FlowRule { source: string; dest: string; enabled: boolean }

const SOURCES = new Set(["garmin", "hevy", "surfr"]);
const DESTS = new Set(["strava", "telegram"]);

/** A single node chip in the flow (source / hub / destination). */
function Node({ label, connected, accent }: { label: string; connected?: boolean; accent?: string }) {
  return (
    <View
      className="rounded-lg border px-3 py-2 items-center"
      style={{
        borderColor: connected === false ? "#3a4650" : accent ?? "#2f6d5b",
        backgroundColor: connected === false ? "#141f26" : (accent ?? "#77c8d1") + "1a",
        minWidth: 96,
      }}
    >
      <Text variant="micro" className={connected === false ? "text-text-muted" : "text-text"}>{label}</Text>
      {connected != null ? (
        <View className="mt-0.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: connected ? "#6ad4a0" : "#5a7a8a" }} />
      ) : null}
    </View>
  );
}

/**
 * Ingest → hub → destinations pipeline diagram (web parity, #444). Mobile
 * stacks the flow vertically; source/destination nodes reflect connection
 * state and the active sync rules are listed as source → dest badges. Fed by
 * the platforms + rules the screen already loads.
 */
export function SyncFlowDiagram({ platforms, rules }: { platforms: FlowPlatform[]; rules: FlowRule[] }) {
  const srcs = platforms.filter((p) => SOURCES.has(p.key));
  const dests = platforms.filter((p) => DESTS.has(p.key));
  if (!srcs.length && !dests.length) return null;
  const activeRules = rules.filter((r) => r.enabled);

  return (
    <Card className="gap-3">
      <Text variant="eyebrow">Sync flow</Text>

      <View className="items-center gap-1.5">
        <Text variant="micro" className="text-text-muted">INGEST</Text>
        <View className="flex-row flex-wrap justify-center gap-2">
          {srcs.map((s) => <Node key={s.key} label={s.label} connected={s.connected} accent="#77c8d1" />)}
        </View>
        <Text variant="body" className="text-text-muted">↓</Text>
        <Node label="soma hub" accent="#cbe896" />
        <Text variant="body" className="text-text-muted">↓</Text>
        <Text variant="micro" className="text-text-muted">DESTINATIONS</Text>
        <View className="flex-row flex-wrap justify-center gap-2">
          {dests.map((d) => <Node key={d.key} label={d.label} connected={d.connected} accent="#e0a458" />)}
        </View>
      </View>

      {activeRules.length ? (
        <View className="gap-1.5 border-t border-border-subtle pt-2.5">
          <Text variant="micro" className="text-text-muted">ACTIVE RULES</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {activeRules.map((r, i) => (
              <Badge key={`${r.source}-${r.dest}-${i}`} label={`${r.source} → ${r.dest}`} tone="teal" />
            ))}
          </View>
        </View>
      ) : (
        <Text variant="micro" className="text-text-muted border-t border-border-subtle pt-2.5">No active sync rules.</Text>
      )}
    </Card>
  );
}
