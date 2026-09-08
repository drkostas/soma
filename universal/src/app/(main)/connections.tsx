import { useEffect, useState } from "react";
import { ScrollView, View, RefreshControl, Pressable, Alert, Linking } from "react-native";
import { Text, Card, Badge, Button, type BadgeTone } from "soma-style";
import { fetchJson, usePullRefresh, setRuleEnabled, triggerSync, deleteSyncRule, createSyncRule, disconnectPlatform, useDuplicates, syncActivityTo, API_BASE } from "../../lib/api";
import { SyncFlowDiagram, type FlowPlatform, type FlowRule } from "../../components/sync-flow-diagram";
import { CredentialsDialog } from "../../components/credentials-dialog";
import { PushNotificationsCard } from "../../components/push-notifications-card";
import { TabStrip } from "../../components/tab-strip";

// ---- Types (subset of the web /connections page, from fetchable endpoints) ----

interface PlatformStatus {
  platform: string;
  status: string;
  connected_at: string | null;
  athlete_name: string | null;
  auth_type: string;
  can_connect: boolean;
  /** Sync-service platforms: raw data present + newest synced_at (web's "Managed by sync service", soma#785). */
  has_data?: boolean;
  last_sync?: string | null;
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
interface StravaActivity { name: string | null; date: string; type_key: string | null; onStrava: boolean; activity_id?: string | null }
interface StravaCoverage { total: number; onStrava: number; recent: StravaActivity[] }
/** Web's Backfill tab rows (backfill_progress). */
interface BackfillRow { source: string; oldest_date_done: string | null; last_page: number; total_items: number; items_completed: number; status: string; updated_at: string }
interface ConnectionsResponse {
  platforms: PlatformStatus[];
  rules: SyncRule[];
  spotify?: SpotifyStatus | null;
  stravaCoverage?: StravaCoverage | null;
  backfill?: BackfillRow[];
}

interface SourceStatus {
  status: string;
  lastSync: string;
  records: number;
  error?: string | null;
}

interface SyncRun { type: string; status: string; records: number; at: string }
interface TableCount { label: string; count: number }
interface SyncStatusResponse {
  lastSync: string | null;
  status: string;
  recordsSynced: number;
  error: string | null;
  sources: Record<string, SourceStatus>;
  history?: SyncRun[];
  tables?: TableCount[];
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

/** Web's Activity Sync Manager tabs: All / Running / Strength / Cycling, by Garmin type key. */
type CoverageTab = "all" | "running" | "strength" | "cycling";
const COVERAGE_TABS: { key: CoverageTab; label: string }[] = [
  { key: "all", label: "All" }, { key: "running", label: "Running" }, { key: "strength", label: "Strength" }, { key: "cycling", label: "Cycling" },
];
function sportOf(typeKey: string | null): CoverageTab | "other" {
  const k = (typeKey || "").toLowerCase();
  if (k.includes("running") || k.includes("treadmill")) return "running";
  if (k.includes("strength")) return "strength";
  if (k.includes("cycling") || k.includes("biking") || k.includes("bike")) return "cycling";
  return "other";
}

function isConnected(p: PlatformStatus | undefined): boolean {
  // Web's rule for sync-service platforms: data in the raw table means the service manages it,
  // whether or not a credentials row exists (Hevy never has one on this install).
  return p?.status === "active" || p?.status === "connected" || p?.has_data === true;
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

/** Hermes' Date() rejects Postgres' text timestamps ("2026-02-21 04:43:07.647075+00"); normalise
 *  them to ISO (T separator, millisecond fraction, "+00:00" offset) before parsing. */
function parseTs(v: string): Date {
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/);
  if (!m) return d;
  const frac = m[3] ? `.${m[3].slice(0, 3).padEnd(3, "0")}` : "";
  let tz = m[4] ?? "Z";
  if (/^[+-]\d{2}$/.test(tz)) tz = `${tz}:00`;
  else if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  return new Date(`${m[1]}T${m[2]}${frac}${tz}`);
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseTs(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "No syncs yet";
  const d = parseTs(iso);
  if (Number.isNaN(d.getTime())) return "No syncs yet";
  return d.toLocaleString();
}

/** Inline "add sync rule" form: pick a source + destination, then create. */
/** Web's Add Rule form: source, activity type (* / strength / running / cycling / kite) and
 *  destination (strava / garmin / telegram) — the app used to allow source + destination only (soma#795). */
const ACTIVITY_TYPES = [{ value: "*", label: "All" }, { value: "strength", label: "Strength" }, { value: "running", label: "Running" }, { value: "cycling", label: "Cycling" }, { value: "kite", label: "Kite" }];
function QuickAddRule({ sources, onCreate }: { sources: string[]; onCreate: (source: string, dest: string, activityType: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [activityType, setActivityType] = useState<string>("*");
  const [busy, setBusy] = useState(false);
  const srcOptions = sources.length ? sources : ["garmin", "hevy"];
  const destOptions = ["strava", "garmin", "telegram"];

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6} className="pt-1">
        <Text variant="caption" className="text-teal">+ Add rule</Text>
      </Pressable>
    );
  }
  const Pill = ({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) => (
    <Pressable onPress={onPress} hitSlop={4} testID={testID} accessibilityRole="radio" accessibilityState={{ selected: active }}>
      <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: active ? "#77c8d133" : "#142530" }}>
        <Text variant="micro" style={{ color: active ? "#77c8d1" : "#8aa0ac" }}>{label}</Text>
      </View>
    </Pressable>
  );
  return (
    <View className="gap-2 border-t border-border-subtle pt-2">
      <Text variant="micro" className="text-text-muted">Source</Text>
      <View className="flex-row flex-wrap gap-2">
        {srcOptions.map((s) => <Pill key={s} label={s} active={source === s} onPress={() => setSource(s)} testID={`rule-src-${s}`} />)}
      </View>
      <Text variant="micro" className="text-text-muted">Activity type</Text>
      <View className="flex-row flex-wrap gap-2" testID="rule-activity-types">
        {ACTIVITY_TYPES.map((t) => <Pill key={t.value} label={t.label} active={activityType === t.value} onPress={() => setActivityType(t.value)} testID={`rule-type-${t.value === "*" ? "all" : t.value}`} />)}
      </View>
      <Text variant="micro" className="text-text-muted">Destination</Text>
      <View className="flex-row flex-wrap gap-2">
        {destOptions.map((d) => <Pill key={d} label={d} active={dest === d} onPress={() => setDest(d)} testID={`rule-dest-${d}`} />)}
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
            const ok = await onCreate(source, dest, activityType);
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
  const [coverageTab, setCoverageTab] = useState<CoverageTab>("all");
  const [dialogPlatform, setDialogPlatform] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [deletedRules, setDeletedRules] = useState<Set<number>>(new Set());
  // The rule the user just created gets stable "new" test ids so a device flow can toggle and
  // delete exactly it (soma#795) — no other row is touched by the verify flow.
  const [lastCreatedId, setLastCreatedId] = useState<number | null>(null);
  const [opsTab, setOpsTab] = useState<"Coverage" | "Backfill" | "Duplicates">("Coverage");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const duplicates = useDuplicates(opsTab === "Duplicates");
  function confirmDisconnect(platform: string, label: string) {
    Alert.alert(`Disconnect ${label}?`, `Soma keeps the data already synced; the ${label} link is removed and can be re-connected on the web dashboard.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: async () => {
        const ok = await disconnectPlatform(platform);
        setActionMsg(ok ? `${label} disconnected.` : `Couldn't disconnect ${label}.`);
        if (ok) refetchConn();
      } },
    ]);
  }
  function confirmSyncToStrava(a: StravaActivity) {
    if (!a.activity_id) return;
    Alert.alert("Sync to Strava?", `Forward "${a.name || "this activity"}" from Garmin to Strava now.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Sync", onPress: async () => {
        const ok = await syncActivityTo("garmin", String(a.activity_id), "strava");
        setActionMsg(ok ? "Queued for Strava. Pull to refresh in a moment." : "Couldn't queue the sync.");
        if (ok) refetchConn();
      } },
    ]);
  }
  function openWebSettings(section: string) {
    Linking.openURL(`${API_BASE}/connections#${section}`).catch(() => setActionMsg("Couldn't open the web dashboard."));
  }

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
      const type = r.activity_type && r.activity_type !== "all" ? r.activity_type : "*";
      const key = `${r.source_platform}→${dest}·${type}`;
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }
    return [...groups.entries()].map(([key, rs]) => {
      const [source, destType] = key.split("→");
      const dest = destType.split("·")[0];
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
                    // The platform's own newest raw row (web's MAX(synced_at)) when the API sends it,
                    // else the pipeline's last run.
                    ? `${who}Last synced ${fmtDate(cred?.last_sync ?? sync?.lastSync ?? null)}`
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
                  <Text variant="micro" className="text-text-secondary flex-1 pr-2" testID={`platform-${platform}-detail`}>
                    {detail}
                  </Text>
                  {meta.kind !== "planned" ? (
                    <View className="flex-row items-center gap-1">
                      {connected && meta.kind === "sync-service" ? (
                        <Pressable onPress={() => openWebSettings(platform)} hitSlop={8} testID={`settings-${platform}`} accessibilityRole="link" accessibilityLabel={`${meta.label} settings on the web dashboard`} className="rounded-full px-2 py-1">
                          <Text variant="micro" className="text-text-secondary">Settings ↗</Text>
                        </Pressable>
                      ) : null}
                      {connected && meta.kind === "oauth" ? (
                        <Pressable onPress={() => confirmDisconnect(platform, meta.label)} hitSlop={8} testID={`disconnect-${platform}`} accessibilityRole="button" accessibilityLabel={`Disconnect ${meta.label}`} className="rounded-full px-2 py-1">
                          <Text variant="micro" className="text-danger">Disconnect</Text>
                        </Pressable>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onPress={() => setDialogPlatform(platform)}
                        label={connected ? "Configure" : "Connect"}
                      />
                    </View>
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
            groupedRules.map((g) => {
              const isNew = g.effective.id === lastCreatedId;
              const idSuffix = isNew ? "new" : String(g.effective.id);
              return (
              <View
                key={g.key}
                testID={`rule-row-${idSuffix}`}
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
                  <Pressable onPress={() => toggleRule(g.effective.id, g.effective.enabled)} hitSlop={8} testID={`rule-toggle-${idSuffix}`} accessibilityRole="switch" accessibilityState={{ checked: g.effective.enabled }}>
                    <View testID={`rule-${g.effective.enabled ? "on" : "off"}-${idSuffix}`}>
                      <Badge
                        label={g.effective.enabled ? "On" : "Off"}
                        tone={g.effective.enabled ? "success" : "neutral"}
                      />
                    </View>
                  </Pressable>
                  <Pressable onPress={() => onDeleteRule(g.effective.id)} hitSlop={8} testID={`rule-delete-${idSuffix}`} accessibilityRole="button" accessibilityLabel="Delete rule">
                    <Text variant="micro" className="text-danger">Delete</Text>
                  </Pressable>
                </View>
              </View>
              );
            })
          )}
          <QuickAddRule
            sources={[...new Set((conn?.rules ?? []).map((r) => r.source_platform))]}
            onCreate={async (source, dest, activityType) => {
              const id = await createSyncRule({ source_platform: source, activity_type: activityType, destinations: { [dest]: { enabled: true } } });
              if (id != null) { setLastCreatedId(id); refetchConn(); }
              return id != null;
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

        {/* Pipeline operations — web's Backfill / Duplicates / Data Coverage tabs (soma#795).
            Backfill and duplicates are READ here: web's backfill trigger and duplicate resolver
            both act on Garmin (resolve deletes the duplicate there), so they stay web-only. */}
        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Pipeline operations</Text>
            {actionMsg ? <Text variant="micro" className="text-text-muted flex-1 pl-3 text-right" numberOfLines={2}>{actionMsg}</Text> : null}
          </View>
          <TabStrip
            tabs={[{ key: "Coverage" }, { key: "Backfill" }, { key: "Duplicates" }]}
            value={opsTab}
            onChange={(k) => setOpsTab(k as typeof opsTab)}
          />
          {opsTab === "Backfill" ? (
            <View className="gap-2" testID="backfill-list">
              {(conn?.backfill ?? []).length === 0 ? (
                <Text variant="micro" className="text-text-muted">No backfill has run yet.</Text>
              ) : (conn?.backfill ?? []).map((b) => {
                const pct = b.total_items > 0 ? Math.min(100, Math.round((b.items_completed / b.total_items) * 100)) : 0;
                const tone: BadgeTone = b.status === "complete" || b.status === "done" ? "success" : b.status === "error" ? "danger" : "warm";
                return (
                  <View key={b.source} className="gap-1 border-b border-border-subtle py-1.5">
                    <View className="flex-row items-center justify-between">
                      <Text variant="caption" className="text-text">{b.source}</Text>
                      <Badge label={b.status} tone={tone} />
                    </View>
                    <View className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "#142530" }}>
                      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: "#5ec8c2" }} />
                    </View>
                    <Text variant="micro" className="text-text-muted tabular-nums">
                      {b.items_completed.toLocaleString()}/{b.total_items.toLocaleString()} · page {b.last_page}{b.oldest_date_done ? ` · back to ${fmtDate(b.oldest_date_done)}` : ""} · {fmtDateTime(b.updated_at)}
                    </Text>
                  </View>
                );
              })}
              <Text variant="micro" className="text-text-muted">Start or resume a backfill from the web dashboard. It reads your Garmin history page by page.</Text>
            </View>
          ) : null}
          {opsTab === "Duplicates" ? (
            <View className="gap-2" testID={duplicates.data ? "duplicates-list" : "duplicates-loading"}>
              {!duplicates.data ? (
                <Text variant="micro" className="text-text-muted">Scanning Garmin activities for duplicates…</Text>
              ) : duplicates.data.error ? (
                <Text variant="micro" className="text-warning">Duplicate scan unavailable right now.</Text>
              ) : duplicates.data.pairs.length === 0 ? (
                <Text variant="micro" className="text-text-muted">No duplicate activities found.</Text>
              ) : duplicates.data.pairs.map((p, i) => (
                <View key={`${p.a.id}-${p.b.id}`} className="gap-1 border-b border-border-subtle py-1.5" testID={`duplicate-pair-${i}`}>
                  {[p.a, p.b].map((s) => (
                    <View key={s.id} className="flex-row items-center justify-between">
                      <View className="flex-1 pr-2">
                        <Text variant="caption" className="text-text" numberOfLines={1}>{s.name}</Text>
                        <Text variant="micro" className="text-text-muted">{fmtDateTime(s.startTime)} · {s.type.replace(/_/g, " ")}</Text>
                      </View>
                      <Text variant="micro" className="text-text-secondary tabular-nums">{Math.round(s.duration / 60)} min{s.distance > 0 ? ` · ${(s.distance / 1000).toFixed(1)} km` : ""}</Text>
                    </View>
                  ))}
                </View>
              ))}
              {duplicates.data && duplicates.data.pairs.length > 0 ? (
                <Text variant="micro" className="text-text-muted">Resolving deletes the duplicate on Garmin, so that stays on the web dashboard.</Text>
              ) : null}
            </View>
          ) : null}
          {opsTab === "Coverage" && sync && ((sync.tables?.length ?? 0) > 0 || (sync.history?.length ?? 0) > 0) ? (
            <>
            {sync.tables?.length ? (
              <View className="flex-row flex-wrap gap-x-6 gap-y-2">
                {sync.tables.map((t) => (
                  <View key={t.label} className="gap-0.5">
                    <Text variant="micro" className="text-text-muted">{t.label}</Text>
                    <Text variant="title" className="text-teal tabular-nums">{t.count.toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {sync.history?.length ? (
              <View className="gap-1 border-t border-border-subtle pt-2">
                <Text variant="micro" className="text-text-muted">RECENT RUNS</Text>
                {sync.history.map((r, i) => (
                  <View key={i} className="flex-row items-center justify-between">
                    <Text variant="micro" className="text-text-secondary">{r.type.replace(/_/g, " ")}</Text>
                    <View className="flex-row items-center gap-2">
                      <Text variant="micro" className="tabular-nums text-text-muted">{r.records.toLocaleString()} rec</Text>
                      <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.status === "success" ? "#6ad4a0" : r.status === "error" ? "#e06060" : "#e0a458" }} />
                      <Text variant="micro" className="tabular-nums text-text-muted">{fmtDateTime(r.at)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            </>
          ) : null}
          {opsTab === "Coverage" && !(sync && ((sync.tables?.length ?? 0) > 0 || (sync.history?.length ?? 0) > 0)) ? (
            <Text variant="micro" className="text-text-muted">Pipeline coverage is unavailable right now.</Text>
          ) : null}
        </Card>

        {/* Strava coverage — how many recent Garmin activities reached Strava */}
        {conn?.stravaCoverage && conn.stravaCoverage.total > 0 ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-2">
                <Text variant="eyebrow">Strava coverage</Text>
                <Text variant="micro" className="text-text-muted">Garmin activities forwarded to Strava · last 90 days</Text>
              </View>
              <Text variant="caption" className="tabular-nums text-text">{conn.stravaCoverage.onStrava}/{conn.stravaCoverage.total}</Text>
            </View>
            <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#142530" }}>
              <View style={{ width: `${Math.round((conn.stravaCoverage.onStrava / conn.stravaCoverage.total) * 100)}%`, height: "100%", backgroundColor: "#fc5200" }} />
            </View>
            {/* Web's Activity Sync Manager filters the list by sport with counts (soma#785). */}
            <View className="flex-row flex-wrap gap-1.5">
              {COVERAGE_TABS.map((t) => {
                const rows = conn?.stravaCoverage?.recent ?? [];
                const n = t.key === "all" ? rows.length : rows.filter((a) => sportOf(a.type_key) === t.key).length;
                const on = coverageTab === t.key;
                return (
                  <Pressable key={t.key} onPress={() => setCoverageTab(t.key)} className={`rounded-full px-3 py-1 ${on ? "bg-teal" : "bg-surface-subtle"}`} testID={`coverage-tab-${t.key}`} accessibilityRole="button">
                    <Text variant="micro" className={on ? "text-base" : "text-text-secondary"}>{t.label} {n}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="gap-0.5">
              {conn.stravaCoverage.recent.filter((a) => coverageTab === "all" || sportOf(a.type_key) === coverageTab).map((a, i) => {
                const sport = (a.type_key || "").replace(/_v2$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                return (
                  <View key={`${a.date}-${i}`} className="flex-row items-center justify-between border-b border-border-subtle py-1.5">
                    <View className="flex-1 pr-2">
                      <Text variant="caption" className="text-text" numberOfLines={1}>{a.name || sport || "Activity"}</Text>
                      <Text variant="micro" className="text-text-muted">{fmtDate(a.date)}{sport ? ` · ${sport}` : ""}</Text>
                    </View>
                    {a.onStrava
                      ? <Badge label="On Strava" tone="warm" />
                      : a.activity_id
                        ? (
                          <Pressable onPress={() => confirmSyncToStrava(a)} hitSlop={8} testID={`sync-row-${i}`} accessibilityRole="button" accessibilityLabel="Sync to Strava" className="rounded-full bg-surface-subtle px-2.5 py-1">
                            <Text variant="micro" className="text-teal">Sync to Strava</Text>
                          </Pressable>
                        )
                        : <Text variant="micro" className="text-text-muted">not synced</Text>}
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        {/* Spotify (music features) */}
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-2">
              <Text variant="eyebrow">Spotify</Text>
              <Text variant="micro" className="text-text-muted">Tempo-matched running playlists</Text>
            </View>
            <View className="flex-row items-center gap-2">
              {conn?.spotify ? (
                <Pressable onPress={() => confirmDisconnect("spotify", "Spotify")} hitSlop={8} testID="disconnect-spotify" accessibilityRole="button" accessibilityLabel="Disconnect Spotify">
                  <Text variant="micro" className="text-danger">Disconnect</Text>
                </Pressable>
              ) : null}
              <Badge label={conn?.spotify ? "Connected" : "Web sign-in"} tone={conn?.spotify ? "success" : "neutral"} />
            </View>
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
