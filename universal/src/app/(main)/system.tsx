import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Text, Card, Badge, type BadgeTone } from "soma-style";
import { fetchJson } from "../../lib/api";

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

/** soma's platform connections + sync rules (Sync Hub). */
function useConnections() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<ConnectionsResponse>("/api/connections")
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);
  return { data, error };
}

/** soma's data-pipeline sync status (last run per source). */
function useSyncStatus() {
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<SyncStatusResponse>("/api/sync/status")
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);
  return { data, error };
}

const PLATFORM_LABEL: Record<string, string> = {
  garmin: "Garmin Connect",
  hevy: "Hevy",
  strava: "Strava",
  telegram: "Telegram",
  surfr: "Surfr",
};

const PLATFORM_DESC: Record<string, string> = {
  garmin: "Fitness watch data, daily health, activities",
  hevy: "Strength training workouts and exercises",
  strava: "Activity sharing and social fitness",
  telegram: "Workout card images sent to your phone",
  surfr: "Kitesurf sessions and jump analytics",
};

function isConnected(status: string): boolean {
  return status === "active" || status === "connected";
}

function statusBadge(p: PlatformStatus): { label: string; tone: BadgeTone } {
  if (isConnected(p.status)) {
    return p.can_connect
      ? { label: "Connected", tone: "success" }
      : { label: "Sync Service", tone: "teal" };
  }
  return { label: "Disconnected", tone: "neutral" };
}

const SYNC_TONE: Record<string, BadgeTone> = {
  success: "success",
  completed: "success",
  running: "teal",
  error: "danger",
  failed: "danger",
  never: "neutral",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "No syncs yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No syncs yet";
  return d.toLocaleString();
}

export default function StatusScreen() {
  const { data: conn, error: connError } = useConnections();
  const { data: sync, error: syncError } = useSyncStatus();

  const platforms = conn?.platforms ?? [];
  const rules = conn?.rules ?? [];

  const connectedCount = platforms.filter((p) => isConnected(p.status)).length;
  const activeRules = rules.filter((r) => r.enabled).length;
  const totalRecords = sync
    ? Object.values(sync.sources).reduce((s, x) => s + (x.records ?? 0), 0)
    : 0;
  const sourceRows = sync ? Object.entries(sync.sources) : [];

  const stats: { label: string; value: string; cls: string }[] = [
    { label: "Platforms", value: `${connectedCount}`, cls: "text-teal" },
    { label: "Active Rules", value: `${activeRules}`, cls: "text-lime" },
    { label: "Records Synced", value: totalRecords.toLocaleString(), cls: "text-warm" },
    { label: "Overall", value: sync?.status ?? "—", cls: "text-indigo" },
  ];

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="gap-1">
          <Text variant="headline">Sync Hub</Text>
          <Text variant="caption" className="text-text-secondary">
            Integrations, sync rules, and pipeline status
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
            <Card key={s.label} className="min-w-[46%] flex-1 gap-1">
              <Text variant="eyebrow">{s.label}</Text>
              <Text variant="headline" className={s.cls}>
                {s.value}
              </Text>
            </Card>
          ))}
        </View>

        {/* Last sync summary */}
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Last sync</Text>
            {sync ? (
              <Badge label={sync.status} tone={SYNC_TONE[sync.status] ?? "neutral"} />
            ) : null}
          </View>
          <Text variant="body" className="text-text">
            {fmtDateTime(sync?.lastSync ?? null)}
          </Text>
          {sync?.error ? (
            <Text variant="micro" className="text-danger">
              {sync.error}
            </Text>
          ) : null}
        </Card>

        {/* Platform connection cards */}
        <Card className="gap-3">
          <Text variant="eyebrow">Platforms</Text>
          {platforms.length === 0 && !connError ? (
            <Text variant="micro">Loading connections…</Text>
          ) : null}
          {platforms.map((p) => {
            const badge = statusBadge(p);
            return (
              <View
                key={p.platform}
                className="flex-row items-start justify-between gap-2 border-b border-border-subtle py-2"
              >
                <View className="flex-1 gap-0.5">
                  <Text variant="body" className="text-text">
                    {PLATFORM_LABEL[p.platform] ?? p.platform}
                  </Text>
                  <Text variant="micro">{PLATFORM_DESC[p.platform] ?? p.auth_type}</Text>
                  {p.athlete_name ? (
                    <Text variant="micro" className="text-text-secondary">
                      {p.athlete_name}
                    </Text>
                  ) : null}
                  {isConnected(p.status) && p.connected_at ? (
                    <Text variant="micro">
                      {p.can_connect ? "Connected" : "Last synced"} {fmtDate(p.connected_at)}
                    </Text>
                  ) : null}
                </View>
                <Badge label={badge.label} tone={badge.tone} />
              </View>
            );
          })}
        </Card>

        {/* Sync sources / pipeline */}
        {sourceRows.length ? (
          <Card className="gap-2">
            <Text variant="eyebrow">Recent sync activity</Text>
            {sourceRows.map(([type, s]) => (
              <View
                key={type}
                className="flex-row items-center justify-between border-b border-border-subtle py-2"
              >
                <View className="flex-1 gap-0.5">
                  <Text variant="body" className="capitalize text-text-secondary">
                    {type}
                  </Text>
                  <Text variant="micro">{fmtDateTime(s.lastSync)}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text variant="caption" className="tabular-nums text-text">
                    {(s.records ?? 0).toLocaleString()}
                  </Text>
                  <Badge label={s.status} tone={SYNC_TONE[s.status] ?? "neutral"} />
                </View>
              </View>
            ))}
          </Card>
        ) : syncError ? (
          <Card>
            <Text variant="micro" className="text-danger">
              Sync status: {syncError}
            </Text>
          </Card>
        ) : null}

        {/* Sync rules */}
        {rules.length ? (
          <Card className="gap-2">
            <Text variant="eyebrow">Sync rules</Text>
            {rules.map((r) => (
              <View
                key={r.id}
                className="flex-row items-center justify-between border-b border-border-subtle py-2"
              >
                <View className="flex-1">
                  <Text variant="body" className="text-text-secondary">
                    <Text variant="body" className="capitalize text-text">
                      {r.source_platform}
                    </Text>{" "}
                    · {r.activity_type}
                  </Text>
                </View>
                <Badge
                  label={r.enabled ? "On" : "Off"}
                  tone={r.enabled ? "success" : "neutral"}
                />
              </View>
            ))}
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}
