import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import { Text, Card, Badge, type BadgeTone } from "soma-style";
import { fetchJson, usePullRefresh, setRuleEnabled } from "../../lib/api";

// ---- Types (subset of the web /connections page, from fetchable endpoints) ----

interface PlatformStatus {
  platform: string;
  status: string;
  connected_at: string | null;
  athlete_name: string | null;
  auth_type: string;
  can_connect: boolean;
}

interface SyncRule {
  id: number;
  source_platform: string;
  activity_type: string;
  preprocessing: string[];
  destinations: Record<string, unknown>;
  enabled: boolean;
  priority: number;
}

interface ConnectionsResponse {
  platforms: PlatformStatus[];
  rules: SyncRule[];
}

interface SourceStatus {
  status: string;
  lastSync: string;
  records: number;
}

interface SyncStatusResponse {
  lastSync: string | null;
  status: string;
  recordsSynced: number;
  error: string | null;
  sources: Record<string, SourceStatus>;
}

// ---- Inline data hooks (matching useToday / useTraining pattern) ----

/** soma's platform connections + sync rules. */
function useConnections() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<ConnectionsResponse>("/api/connections")
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [reload]);
  return { data, error, refetch: () => setReload((n) => n + 1) };
}

/** soma's sync-pipeline status (per-source last sync + records). */
function useSyncStatus() {
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchJson<SyncStatusResponse>("/api/sync/status")
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [reload]);
  return { data, error, refetch: () => setReload((n) => n + 1) };
}

// ---- Static platform config (mirrors the web page's platformConfig) ----

const PLATFORM_META: Record<
  string,
  { label: string; description: string; kind: "oauth" | "sync-service" | "planned" }
> = {
  garmin: {
    label: "Garmin Connect",
    description: "Fitness watch data, daily health, activities",
    kind: "sync-service",
  },
  hevy: {
    label: "Hevy",
    description: "Strength training workouts and exercises",
    kind: "sync-service",
  },
  strava: {
    label: "Strava",
    description: "Activity sharing and social fitness",
    kind: "oauth",
  },
  telegram: {
    label: "Telegram",
    description: "Workout card images sent to your phone",
    kind: "sync-service",
  },
  surfr: {
    label: "Surfr",
    description: "Kitesurf sessions and jump analytics",
    kind: "planned",
  },
};

const PLATFORM_ORDER = ["garmin", "hevy", "strava", "telegram", "surfr"];

function isConnected(p: PlatformStatus | undefined): boolean {
  return p?.status === "active" || p?.status === "connected";
}

function statusBadge(
  meta: { kind: "oauth" | "sync-service" | "planned" },
  connected: boolean,
): { label: string; tone: BadgeTone } {
  if (meta.kind === "planned") return { label: "Coming soon", tone: "neutral" };
  if (connected)
    return meta.kind === "sync-service"
      ? { label: "Sync service", tone: "teal" }
      : { label: "Connected", tone: "success" };
  return { label: "Disconnected", tone: "danger" };
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "No syncs yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No syncs yet";
  return d.toLocaleString();
}

export default function ConnectionsScreen() {
  const { data: conn, error: connError, refetch: refetchConn } = useConnections();
  const { data: sync, error: syncError, refetch: refetchSync } = useSyncStatus();
  const { refreshing, onRefresh } = usePullRefresh(() => {
    refetchConn();
    refetchSync();
  });

  const platforms = conn?.platforms ?? [];
  // optimistic enable/disable overrides so the toggle flips instantly
  const [ruleOverride, setRuleOverride] = useState<Record<number, boolean>>({});
  const rules = (conn?.rules ?? []).map((r) =>
    r.id in ruleOverride ? { ...r, enabled: ruleOverride[r.id] } : r,
  );
  async function toggleRule(id: number, current: boolean) {
    const next = !current;
    setRuleOverride((m) => ({ ...m, [id]: next }));
    const ok = await setRuleEnabled(id, next);
    if (!ok) setRuleOverride((m) => ({ ...m, [id]: current })); // revert on failure
  }
  const credMap: Record<string, PlatformStatus> = Object.fromEntries(
    platforms.map((p) => [p.platform, p]),
  );

  // Stats strip
  const connectedCount = PLATFORM_ORDER.filter((p) => {
    if (PLATFORM_META[p].kind === "planned") return false;
    return isConnected(credMap[p]);
  }).length;
  const activeRulesCount = rules.filter((r) => r.enabled).length;
  const totalRecords = sync
    ? Object.values(sync.sources).reduce((s, x) => s + (x.records || 0), 0)
    : 0;
  const lastSyncTime = fmtDateTime(sync?.lastSync ?? null);

  const stats: { label: string; value: string; cls: string }[] = [
    { label: "Platforms", value: `${connectedCount}`, cls: "text-teal" },
    { label: "Active Rules", value: `${activeRulesCount}`, cls: "text-lime" },
    { label: "Records synced", value: totalRecords.toLocaleString(), cls: "text-warm" },
  ];

  // Recent sync activity from the per-source status map
  const syncSources = sync
    ? Object.entries(sync.sources)
        .map(([name, s]) => ({ name, ...s }))
        .sort((a, b) => new Date(b.lastSync).getTime() - new Date(a.lastSync).getTime())
    : [];

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" colors={["#77c8d1"]} />}
    >
      <View className="w-full max-w-2xl gap-4">
        <View className="gap-1">
          <Text variant="headline">Sync Hub</Text>
          <Text variant="caption" className="text-text-secondary">
            Integrations, sync rules, and data pipeline
          </Text>
        </View>

        {connError ? (
          <Card>
            <Text variant="body" className="text-danger">
              API: {connError} — is soma running on :3456?
            </Text>
          </Card>
        ) : null}

        {/* Stats strip */}
        <View className="flex-row flex-wrap gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="min-w-[30%] flex-1 gap-1">
              <Text variant="eyebrow">{s.label}</Text>
              <Text variant="headline" className={s.cls}>
                {s.value}
              </Text>
            </Card>
          ))}
          <Card className="min-w-[46%] flex-1 gap-1">
            <Text variant="eyebrow">Last sync</Text>
            <Text variant="caption" className="text-text">
              {lastSyncTime}
            </Text>
          </Card>
        </View>

        {/* Platform cards */}
        <View className="gap-3">
          <Text variant="eyebrow">Platforms</Text>
          {PLATFORM_ORDER.map((platform) => {
            const meta = PLATFORM_META[platform];
            const cred = credMap[platform];
            const connected = meta.kind !== "planned" && isConnected(cred);
            const badge = statusBadge(meta, connected);
            const detail =
              meta.kind === "planned"
                ? "Not yet available"
                : connected
                  ? cred?.athlete_name
                    ? `${cred.athlete_name} · ${
                        meta.kind === "sync-service" ? "synced" : "connected"
                      } ${fmtDate(cred?.connected_at)}`
                    : `${meta.kind === "sync-service" ? "Last synced" : "Connected"} ${fmtDate(
                        cred?.connected_at,
                      )}`
                  : "Not connected";

            return (
              <Card key={platform} className="gap-2">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 gap-0.5 pr-2">
                    <Text variant="body" className="text-text">
                      {meta.label}
                    </Text>
                    <Text variant="micro">{meta.description}</Text>
                  </View>
                  <Badge label={badge.label} tone={badge.tone} />
                </View>
                <Text variant="micro" className="text-text-secondary">
                  {detail}
                </Text>
              </Card>
            );
          })}
        </View>

        {/* Sync rules */}
        <Card className="gap-2">
          <Text variant="eyebrow">Sync rules</Text>
          {rules.length === 0 ? (
            <Text variant="micro">No sync rules configured.</Text>
          ) : (
            rules.map((r) => (
              <View
                key={r.id}
                className="flex-row items-center justify-between border-b border-border-subtle py-2 last:border-0"
              >
                <View className="flex-1 flex-row items-center gap-2 pr-2">
                  <Text variant="caption" className="text-text-secondary">
                    {r.source_platform}
                  </Text>
                  <Text variant="caption" className="text-text-muted">
                    →
                  </Text>
                  <Text variant="caption" className="text-text">
                    {Object.keys(r.destinations ?? {}).join(", ") || r.activity_type}
                  </Text>
                </View>
                <Pressable onPress={() => toggleRule(r.id, r.enabled)} hitSlop={8}>
                  <Badge
                    label={r.enabled ? "On" : "Off"}
                    tone={r.enabled ? "success" : "neutral"}
                  />
                </Pressable>
              </View>
            ))
          )}
        </Card>

        {/* Recent sync activity (per source) */}
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Recent sync activity</Text>
            {syncError ? (
              <Text variant="micro" className="text-warning">
                unavailable
              </Text>
            ) : null}
          </View>
          {syncSources.length === 0 ? (
            <Text variant="micro">No sync activity yet.</Text>
          ) : (
            syncSources.map((s) => (
              <View
                key={s.name}
                className="flex-row items-center justify-between border-b border-border-subtle py-2 last:border-0"
              >
                <View className="flex-1 gap-0.5 pr-2">
                  <Text variant="body" className="text-text-secondary">
                    {s.name}
                  </Text>
                  <Text variant="micro">{fmtDateTime(s.lastSync)}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text variant="caption" className="tabular-nums text-text">
                    {s.records.toLocaleString()}
                  </Text>
                  <Badge
                    label={s.status}
                    tone={
                      s.status === "success"
                        ? "success"
                        : s.status === "error"
                          ? "danger"
                          : s.status === "running"
                            ? "warm"
                            : "neutral"
                    }
                  />
                </View>
              </View>
            ))
          )}
        </Card>
      </View>
    </ScrollView>
  );
}
