import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import Constants from "expo-constants";
import { Text, Card, Badge, type BadgeTone } from "soma-style";
import { API_BASE, AUTH_SOURCE, AUTH_HEADERS, DAEMON_HOST, fetchJson, usePullRefresh, hostOf } from "../../lib/api";

/** What web's /status (which is the Connections page) shows, through the API (soma#796):
 *  sync status per source, table coverage, platform links, plus this client's own facts. */
interface SyncStatusResponse {
  lastSync: string | null;
  status: string;
  recordsSynced: number;
  error: string | null;
  sources: Record<string, { status: string; lastSync: string | null; records: number; error: string | null }>;
  history?: { type: string; status: string; records: number; at: string }[];
  tables?: { label: string; count: number }[];
}
interface PlatformRow { platform: string; status: string; connected_at?: string | null; has_data?: boolean; last_sync?: string | null }
interface ConnectionsResponse { platforms: PlatformRow[]; rules: { id: number; enabled: boolean }[]; spotify?: { tracks: number } | null }

const LABELS: Record<string, string> = { garmin: "Garmin Connect", hevy: "Hevy", strava: "Strava", telegram: "Telegram", surfr: "Surfr" };
const SOURCE_LABEL: Record<string, string> = { embedded: "Embedded build token", stored: "Stored on this device", none: "No token" };

function fmt(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}
function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
function toneFor(status: string): BadgeTone {
  return status === "success" || status === "active" || status === "connected" ? "success" : status === "error" ? "danger" : "neutral";
}

export default function SystemScreen() {
  const [sync, setSync] = useState<SyncStatusResponse | null>(null);
  const [conn, setConn] = useState<ConnectionsResponse | null>(null);
  const [health, setHealth] = useState<"checking" | "ok" | "rejected" | "unreachable">("checking");
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { refreshing, onRefresh } = usePullRefresh(() => setReload((n) => n + 1));

  useEffect(() => {
    let alive = true;
    setHealth("checking");
    fetch(`${API_BASE}/api/health/today`, { headers: { ...AUTH_HEADERS } })
      .then((r) => { if (!alive) return; setHealth(r.ok && (r.headers.get("content-type") ?? "").includes("json") ? "ok" : "rejected"); })
      .catch(() => alive && setHealth("unreachable"));
    fetchJson<SyncStatusResponse>("/api/sync/status").then((d) => alive && setSync(d)).catch((e) => alive && setError(String(e?.message ?? e)));
    fetchJson<ConnectionsResponse>("/api/connections").then((d) => alive && setConn(d)).catch(() => {});
    return () => { alive = false; };
  }, [reload]);

  const version = Constants.expoConfig?.version ?? "dev";
  const sources = Object.entries(sync?.sources ?? {});
  const platforms = (conn?.platforms ?? []).filter((p) => p.platform !== "surfr");
  const healthLabel = health === "ok" ? "Reachable" : health === "rejected" ? "Token rejected" : health === "unreachable" ? "Unreachable" : "Checking…";

  return (
    <ScrollView
      className="flex-1 bg-base"
      contentContainerClassName="items-center px-5 py-6"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#77c8d1" />}
    >
      <View className="w-full max-w-2xl gap-4">
        <View className="gap-1">
          <Text variant="headline">Status</Text>
          <Text variant="caption" className="text-text-secondary">This app, its server and the sync pipeline</Text>
        </View>

        <Card className="gap-2" testID="system-api">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">API</Text>
            <Badge label={healthLabel} tone={health === "ok" ? "success" : health === "checking" ? "neutral" : "danger"} />
          </View>
          <Row label="Server" value={hostOf(API_BASE)} />
          <Row label="Daemon host" value={DAEMON_HOST} />
          <Row label="Access" value={SOURCE_LABEL[AUTH_SOURCE] ?? AUTH_SOURCE} />
          <Row label="App version" value={version} />
        </Card>

        <Card className="gap-2" testID="system-sync">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Sync pipeline</Text>
            {sync ? <Badge label={sync.status} tone={toneFor(sync.status)} /> : null}
          </View>
          {error ? <Text variant="micro" className="text-warning">{error}</Text> : null}
          {sync ? (
            <>
              <Row label="Last sync" value={`${fmt(sync.lastSync)}${ago(sync.lastSync) ? ` · ${ago(sync.lastSync)}` : ""}`} />
              <Row label="Records" value={sync.recordsSynced.toLocaleString()} />
              {sync.error ? <Row label="Error" value={sync.error} /> : null}
              {sources.length ? (
                <View className="gap-1 border-t border-border-subtle pt-2">
                  {sources.map(([name, s]) => (
                    <View key={name} className="flex-row items-center justify-between">
                      <Text variant="micro" className="text-text-secondary">{name.replace(/_/g, " ")}</Text>
                      <View className="flex-row items-center gap-2">
                        <Text variant="micro" className="tabular-nums text-text-muted">{s.records.toLocaleString()} rec · {ago(s.lastSync) || fmt(s.lastSync)}</Text>
                        <Badge label={s.status} tone={toneFor(s.status)} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              {sync.tables?.length ? (
                <View className="flex-row flex-wrap gap-x-6 gap-y-2 border-t border-border-subtle pt-2">
                  {sync.tables.map((t) => (
                    <View key={t.label} className="gap-0.5">
                      <Text variant="micro" className="text-text-muted">{t.label}</Text>
                      <Text variant="title" className="text-teal tabular-nums">{t.count.toLocaleString()}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : !error ? <Text variant="micro" className="text-text-muted">Loading…</Text> : null}
        </Card>

        <Card className="gap-2" testID={conn ? "system-platforms" : "system-platforms-loading"}>
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Platforms</Text>
            {conn ? <Text variant="micro" className="text-text-muted">{conn.rules.filter((r) => r.enabled).length} rules on</Text> : null}
          </View>
          {platforms.map((p) => {
            const linked = p.status === "active" || p.status === "connected" || p.has_data === true;
            return (
              <View key={p.platform} className="flex-row items-center justify-between">
                <Text variant="caption" className="text-text">{LABELS[p.platform] ?? p.platform}</Text>
                <View className="flex-row items-center gap-2">
                  <Text variant="micro" className="text-text-muted">{p.last_sync ? `synced ${ago(p.last_sync) || fmt(p.last_sync)}` : p.connected_at ? `since ${fmt(p.connected_at).split(",")[0]}` : ""}</Text>
                  <Badge label={linked ? "Linked" : "Not linked"} tone={linked ? "success" : "neutral"} />
                </View>
              </View>
            );
          })}
          {conn ? (
            <View className="flex-row items-center justify-between">
              <Text variant="caption" className="text-text">Spotify</Text>
              <Badge label={conn.spotify ? "Linked" : "Not linked"} tone={conn.spotify ? "success" : "neutral"} />
            </View>
          ) : <Text variant="micro" className="text-text-muted">Loading…</Text>}
        </Card>
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text variant="micro" className="text-text-muted">{label}</Text>
      <Text variant="micro" className="text-text-secondary flex-1 text-right" numberOfLines={2}>{value}</Text>
    </View>
  );
}
