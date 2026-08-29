import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import { Text, Card, Badge, Button, type BadgeTone } from "soma-style";
import { fetchJson, usePullRefresh, setRuleEnabled, triggerSync, deleteSyncRule, createSyncRule } from "../../lib/api";
import { SyncFlowDiagram, type FlowPlatform, type FlowRule } from "../../components/sync-flow-diagram";
import { CredentialsDialog } from "../../components/credentials-dialog";
import { PushNotificationsCard } from "../../components/push-notifications-card";

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

interface SpotifyStatus { tracks: number; artists: number; last_sync: string | null }
interface ConnectionsResponse {
  platforms: PlatformStatus[];
  rules: SyncRule[];
  spotify?: SpotifyStatus | null;
}

interface SourceStatus {
  status: string;
  lastSync: string;
  records: number;
  error?: string | null;
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

/** Inline "add sync rule" form: pick a source + destination, then create. */
function QuickAddRule({ sources, onCreate }: { sources: string[]; onCreate: (source: string, dest: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const srcOptions = sources.length ? sources : ["garmin", "hevy"];
  const destOptions = ["strava", "telegram"];

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6} className="pt-1">
        <Text variant="caption" className="text-teal">+ Add rule</Text>
      </Pressable>
    );
  }
  const Pill = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <Pressable onPress={onPress} hitSlop={4}>
      <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: active ? "#77c8d133" : "#142530" }}>
        <Text variant="micro" style={{ color: active ? "#77c8d1" : "#8aa0ac" }}>{label}</Text>
      </View>
    </Pressable>
  );
  return (
    <View className="gap-2 border-t border-border-subtle pt-2">
      <Text variant="micro" className="text-text-muted">Source</Text>
      <View className="flex-row flex-wrap gap-2">
        {srcOptions.map((s) => <Pill key={s} label={s} active={source === s} onPress={() => setSource(s)} />)}
      </View>
      <Text variant="micro" className="text-text-muted">Destination</Text>
      <View className="flex-row flex-wrap gap-2">
        {destOptions.map((d) => <Pill key={d} label={d} active={dest === d} onPress={() => setDest(d)} />)}
      </View>
      <View className="flex-row gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!source || !dest || busy}
          label={busy ? "Adding…" : "Create rule"}
          onPress={async () => {
            if (!source || !dest) return;
            setBusy(true);
            const ok = await onCreate(source, dest);
            setBusy(false);
            if (ok) { setOpen(false); setSource(null); setDest(null); }
          }}
        />
        <Button variant="ghost" size="sm" label="Cancel" onPress={() => setOpen(false)} />
      </View>
    </View>
  );
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
  const [dialogPlatform, setDialogPlatform] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [deletedRules, setDeletedRules] = useState<Set<number>>(new Set());

  async function onSyncNow() {
    setSyncing(true); setSyncMsg(null);
    const ok = await triggerSync();
    setSyncing(false);
    setSyncMsg(ok ? "Sync started — pull to refresh in a moment." : "Couldn't start a sync right now.");
  }
  async function onDeleteRule(id: number) {
    setDeletedRules((s) => new Set(s).add(id)); // optimistic
    const ok = await deleteSyncRule(id);
    if (!ok) setDeletedRules((s) => { const n = new Set(s); n.delete(id); return n; }); // revert
  }
  const rules = (conn?.rules ?? [])
    .filter((r) => !deletedRules.has(r.id))
    .map((r) => (r.id in ruleOverride ? { ...r, enabled: ruleOverride[r.id] } : r));
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

  // Short labels so the eyebrow fits a 3-up strip on a 390px phone (was wrapping
  // "Platforms" to "PLATFORM S").
  const stats: { label: string; value: string; cls: string }[] = [
    { label: "Linked", value: `${connectedCount}`, cls: "text-teal" },
    { label: "Rules on", value: `${activeRulesCount}`, cls: "text-lime" },
    { label: "Records", value: totalRecords.toLocaleString(), cls: "text-warm" },
  ];

  // Group sync rules by source→destination. The DB has duplicates (e.g. three
  // garmin→strava rules, some on, some off) which rendered as contradictory
  // rows. Collapse to one row per pair, showing the EFFECTIVE state (an enabled
  // rule wins; ties break on priority) and a ×N count. Toggling flips the
  // effective rule.
  const groupedRules = (() => {
    const groups = new Map<string, SyncRule[]>();
    for (const r of rules) {
      const dest = Object.keys(r.destinations ?? {}).join(", ") || r.activity_type;
      const key = `${r.source_platform}→${dest}`;
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }
    return [...groups.entries()].map(([key, rs]) => {
      const [source, dest] = key.split("→");
      const effective = [...rs].sort(
        (a, b) => Number(b.enabled) - Number(a.enabled) || b.priority - a.priority || a.id - b.id,
      )[0];
      return { key, source, dest, effective, count: rs.length };
    });
  })();

  const flowPlatforms: FlowPlatform[] = PLATFORM_ORDER
    .filter((p) => PLATFORM_META[p].kind !== "planned")
    .map((p) => ({ key: p, label: PLATFORM_META[p].label, connected: isConnected(credMap[p]) }));
  const flowRules: FlowRule[] = groupedRules.map((g) => ({ source: g.source, dest: g.dest, enabled: g.effective.enabled }));

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
              <Text variant="eyebrow" numberOfLines={1}>{s.label}</Text>
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

        {/* Sync flow diagram (ingest → hub → destinations) */}
        <SyncFlowDiagram platforms={flowPlatforms} rules={flowRules} />

        {/* Pipeline: manual sync trigger */}
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-2">
              <Text variant="eyebrow">Pipeline</Text>
              <Text variant="micro" className="text-text-muted">Run the sync pipeline now</Text>
            </View>
            <Button variant="secondary" size="sm" onPress={onSyncNow} disabled={syncing} label={syncing ? "Starting…" : "Sync now"} />
          </View>
          {syncMsg ? <Text variant="micro" className="text-text-secondary">{syncMsg}</Text> : null}
        </Card>

        {/* Platform cards */}
        <View className="gap-3">
          <Text variant="eyebrow">Platforms</Text>
          {PLATFORM_ORDER.map((platform) => {
            const meta = PLATFORM_META[platform];
            const cred = credMap[platform];
            const connected = meta.kind !== "planned" && isConnected(cred);
            const badge = statusBadge(meta, connected);
            // Sync-service "Last synced" must use the pipeline's real last-run
            // time, NOT connected_at (the day the integration was linked — showed
            // a stale "4/13" while data was fresh to 7/16).
            const who = cred?.athlete_name ? `${cred.athlete_name} · ` : "";
            const detail =
              meta.kind === "planned"
                ? "Not yet available"
                : connected
                  ? meta.kind === "sync-service"
                    ? `${who}Last synced ${fmtDate(sync?.lastSync ?? null)}`
                    : `${who}Connected ${fmtDate(cred?.connected_at)}`
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
                <View className="flex-row items-center justify-between">
                  <Text variant="micro" className="text-text-secondary flex-1 pr-2">
                    {detail}
                  </Text>
                  {meta.kind !== "planned" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => setDialogPlatform(platform)}
                      label={connected ? "Configure" : "Connect"}
                    />
                  ) : null}
                </View>
              </Card>
            );
          })}
        </View>

        {/* Sync rules */}
        <Card className="gap-2">
          <Text variant="eyebrow">Sync rules</Text>
          {groupedRules.length === 0 ? (
            <Text variant="micro">No sync rules configured.</Text>
          ) : (
            groupedRules.map((g) => (
              <View
                key={g.key}
                className="flex-row items-center justify-between border-b border-border-subtle py-2 last:border-0"
              >
                <View className="flex-1 gap-0.5 pr-2">
                  <View className="flex-row items-center gap-2">
                    <Text variant="caption" className="text-text-secondary">
                      {g.source}
                    </Text>
                    <Text variant="caption" className="text-text-muted">
                      →
                    </Text>
                    <Text variant="caption" className="text-text">
                      {g.dest}
                    </Text>
                    {g.count > 1 ? (
                      <Text variant="micro" className="text-text-muted">
                        ×{g.count}
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="micro" className="text-text-muted">
                    {g.effective.activity_type && g.effective.activity_type !== "all" && g.effective.activity_type !== "*" ? g.effective.activity_type : "all activities"}
                    {g.effective.preprocessing?.length ? ` · ${g.effective.preprocessing.join(", ")}` : ""}
                    {` · priority ${g.effective.priority}`}
                  </Text>
                </View>
                <View className="flex-row items-center gap-3">
                  <Pressable onPress={() => toggleRule(g.effective.id, g.effective.enabled)} hitSlop={8}>
                    <Badge
                      label={g.effective.enabled ? "On" : "Off"}
                      tone={g.effective.enabled ? "success" : "neutral"}
                    />
                  </Pressable>
                  <Pressable onPress={() => onDeleteRule(g.effective.id)} hitSlop={8}>
                    <Text variant="micro" className="text-danger">Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
          <QuickAddRule
            sources={[...new Set((conn?.rules ?? []).map((r) => r.source_platform))]}
            onCreate={async (source, dest) => {
              const ok = await createSyncRule({ source_platform: source, activity_type: "all", destinations: { [dest]: true } });
              if (ok) refetchConn();
              return ok;
            }}
          />
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
                  {s.error ? <Text variant="micro" className="text-danger" numberOfLines={2}>⚠ {s.error}</Text> : null}
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

        {/* Spotify (music features) */}
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-2">
              <Text variant="eyebrow">Spotify</Text>
              <Text variant="micro" className="text-text-muted">Tempo-matched running playlists</Text>
            </View>
            <Badge label={conn?.spotify ? "Connected" : "Web sign-in"} tone={conn?.spotify ? "success" : "neutral"} />
          </View>
          {conn?.spotify ? (
            <>
              <View className="flex-row flex-wrap gap-x-5 gap-y-1">
                <View className="gap-0.5">
                  <Text variant="micro" className="text-text-muted">Tracks analysed</Text>
                  <Text variant="title" className="text-teal tabular-nums">{conn.spotify.tracks.toLocaleString()}</Text>
                </View>
                <View className="gap-0.5">
                  <Text variant="micro" className="text-text-muted">Artists</Text>
                  <Text variant="title" className="text-indigo tabular-nums">{conn.spotify.artists.toLocaleString()}</Text>
                </View>
              </View>
              {conn.spotify.last_sync ? <Text variant="micro" className="text-text-muted">last synced {fmtDateTime(conn.spotify.last_sync)}</Text> : null}
            </>
          ) : (
            <Text variant="micro" className="text-text-secondary">
              Spotify uses a one-tap OAuth sign-in handled on the soma web dashboard. Connect there, then your library status appears here.
            </Text>
          )}
        </Card>

        {/* Push notification preferences */}
        <PushNotificationsCard />
      </View>

      <CredentialsDialog platform={dialogPlatform} onClose={() => setDialogPlatform(null)} onSaved={refetchConn} />
    </ScrollView>
  );
}
