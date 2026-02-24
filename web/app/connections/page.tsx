import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { ConnectionActions } from "@/components/connection-actions";
import { SyncRulesManager } from "@/components/sync-rules-manager";
import { SyncFlowDiagram } from "@/components/sync-flow-diagram";
import { PipelineOperations } from "@/components/pipeline-operations";
import { ActivitySyncManager, type MergedActivity, type ActivitySource } from "@/components/activity-sync-manager";
import {
  CheckCircle2,
  XCircle,
  Watch,
  Dumbbell,
  Bike,
  Wind,
  Settings2,
  Cable,
  Route,
  Activity,
  Database,
} from "lucide-react";

export const revalidate = 30;

type ConnectionType = "oauth" | "sync-service" | "planned";

const platformConfig: Record<
  string,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    connectionType: ConnectionType;
    connectionHint: string;
  }
> = {
  garmin: {
    label: "Garmin Connect",
    description: "Fitness watch data, daily health, activities",
    icon: Watch,
    connectionType: "sync-service",
    connectionHint: "Managed by sync service",
  },
  hevy: {
    label: "Hevy",
    description: "Strength training workouts and exercises",
    icon: Dumbbell,
    connectionType: "sync-service",
    connectionHint: "Managed by sync service",
  },
  strava: {
    label: "Strava",
    description: "Activity sharing and social fitness",
    icon: Bike,
    connectionType: "oauth",
    connectionHint: "Connect via OAuth",
  },
  surfr: {
    label: "Surfr",
    description: "Kitesurf sessions and jump analytics",
    icon: Wind,
    connectionType: "planned",
    connectionHint: "Coming soon",
  },
};

interface PlatformCredential {
  platform: string;
  status: string;
  connected_at: string | null;
  athlete_name: string | null;
}

interface SyncRule {
  id: number;
  source_platform: string;
  activity_type: string;
  preprocessing: string[];
  destinations: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  created_at: string;
}

interface SyncLogEntry {
  source_platform: string;
  destination: string;
  status: string;
  count: number;
  last_sync: string;
}

interface SyncServiceStatus {
  platform: string;
  has_data: boolean;
  last_sync: string | null;
}

interface BackfillProgress {
  source: string;
  oldest_date_done: string | null;
  last_page: number;
  total_items: number;
  items_completed: number;
  status: string;
  updated_at: string;
}

interface DataCount {
  table_name: string;
  record_count: number;
  unique_dates?: number;
  unique_endpoints?: number;
}

async function getPageData() {
  const sql = getDb();

  const [credentials, rules, syncLog, syncServiceStatus, backfillProgress, syncRunLogs] =
    await Promise.all([
      sql`
        SELECT platform, status, connected_at,
               credentials->>'athlete_name' as athlete_name
        FROM platform_credentials
        ORDER BY platform
      `,
      sql`
        SELECT id, source_platform, activity_type, preprocessing, destinations, enabled, priority, created_at
        FROM sync_rules
        ORDER BY priority DESC, id
      `,
      sql`
        SELECT source_platform, destination, status, COUNT(*)::int as count,
               MAX(processed_at) as last_sync
        FROM activity_sync_log
        GROUP BY source_platform, destination, status
        ORDER BY last_sync DESC NULLS LAST
        LIMIT 20
      `,
      sql`
        SELECT 'garmin' as platform,
               EXISTS(SELECT 1 FROM garmin_raw_data LIMIT 1) as has_data,
               (SELECT MAX(synced_at) FROM garmin_raw_data) as last_sync
        UNION ALL
        SELECT 'hevy' as platform,
               EXISTS(SELECT 1 FROM hevy_raw_data LIMIT 1) as has_data,
               (SELECT MAX(synced_at) FROM hevy_raw_data) as last_sync
      `,
      sql`
        SELECT * FROM backfill_progress ORDER BY source
      `,
      sql`
        SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 10
      `,
    ]);

  // Data count queries
  const [garminDaily, garminActivity, garminProfile, hevy, healthSummary, weight, sleep] =
    await Promise.all([
      sql`SELECT COUNT(*) as count, COUNT(DISTINCT date) as dates, COUNT(DISTINCT endpoint_name) as endpoints FROM garmin_raw_data`,
      sql`SELECT COUNT(*) as count, COUNT(DISTINCT activity_id) as activities FROM garmin_activity_raw`,
      sql`SELECT COUNT(*) as count FROM garmin_profile_raw`,
      sql`SELECT COUNT(*) as count, COUNT(DISTINCT endpoint_name) as endpoints FROM hevy_raw_data`,
      sql`SELECT COUNT(*) as count FROM daily_health_summary`,
      sql`SELECT COUNT(*) as count FROM weight_log`,
      sql`SELECT COUNT(*) as count FROM sleep_detail`,
    ]);

  const dataCounts: DataCount[] = [
    { table_name: "Garmin Daily (raw)", record_count: garminDaily[0]?.count ?? 0, unique_dates: garminDaily[0]?.dates ?? 0, unique_endpoints: garminDaily[0]?.endpoints ?? 0 },
    { table_name: "Garmin Activities (raw)", record_count: garminActivity[0]?.count ?? 0, unique_dates: garminActivity[0]?.activities ?? 0 },
    { table_name: "Garmin Profile (raw)", record_count: garminProfile[0]?.count ?? 0 },
    { table_name: "Hevy (raw)", record_count: hevy[0]?.count ?? 0, unique_endpoints: hevy[0]?.endpoints ?? 0 },
    { table_name: "Health Summary (L2)", record_count: healthSummary[0]?.count ?? 0 },
    { table_name: "Weight Log (L2)", record_count: weight[0]?.count ?? 0 },
    { table_name: "Sleep Detail (L2)", record_count: sleep[0]?.count ?? 0 },
  ];

  // Syncable activities (last 30 days from Garmin + Hevy)
  const [garminActivities, hevyActivities] = await Promise.all([
    sql`
      SELECT ga.activity_id::text AS source_id,
             'garmin' AS source_platform,
             ga.raw_json->>'activityName' AS name,
             ga.raw_json->'activityType'->>'typeKey' AS activity_type,
             ga.raw_json->>'startTimeGMT' AS start_time,
             (ga.raw_json->>'duration')::numeric AS duration,
             (ga.raw_json->>'distance')::numeric AS distance,
             ga.raw_json->>'manufacturer' AS manufacturer,
             asl.status AS sync_status,
             asl.destination_id,
             asl.processed_at AS synced_at
      FROM garmin_activity_raw ga
      LEFT JOIN activity_sync_log asl
        ON asl.source_platform = 'garmin'
        AND asl.source_id = ga.activity_id::text
        AND asl.destination = 'strava'
        AND asl.status IN ('sent', 'external')
      WHERE ga.endpoint_name = 'summary'
        AND ga.raw_json->>'startTimeGMT' >= to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD')
      ORDER BY ga.raw_json->>'startTimeGMT' DESC
    `,
    sql`
      SELECT h.hevy_id AS source_id,
             'hevy' AS source_platform,
             h.raw_json->>'title' AS name,
             'strength' AS activity_type,
             h.raw_json->>'start_time' AS start_time,
             EXTRACT(EPOCH FROM (
               (h.raw_json->>'end_time')::timestamptz - (h.raw_json->>'start_time')::timestamptz
             ))::numeric AS duration,
             NULL::numeric AS distance,
             NULL::text AS manufacturer,
             asl.status AS sync_status,
             asl.destination_id,
             asl.processed_at AS synced_at
      FROM hevy_raw_data h
      LEFT JOIN activity_sync_log asl
        ON asl.source_platform = 'hevy'
        AND asl.source_id = h.hevy_id
        AND asl.destination = 'strava'
        AND asl.status IN ('sent', 'external')
      WHERE h.endpoint_name = 'workout'
        AND h.raw_json->>'start_time' >= to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD')
      ORDER BY h.raw_json->>'start_time' DESC
    `,
  ]);

  // Merge Garmin + Hevy activities by timestamp (±120s) into unified rows
  type RawActivity = {
    source_id: string;
    source_platform: string;
    name: string;
    activity_type: string;
    start_time: string;
    duration: number | null;
    distance: number | null;
    manufacturer: string | null;
    sync_status: string | null;
    destination_id: string | null;
    synced_at: string | null;
  };
  const garminList = garminActivities as unknown as RawActivity[];
  const hevyList = hevyActivities as unknown as RawActivity[];

  function parseEpoch(ts: string | null): number {
    if (!ts) return 0;
    const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
    return d.getTime() / 1000;
  }

  const mergedActivities: MergedActivity[] = [];
  const matchedGarminIds = new Set<string>();

  // For each Hevy workout, find a Garmin match within ±120s
  for (const hevy of hevyList) {
    const hevyEpoch = parseEpoch(hevy.start_time);
    let bestMatch: RawActivity | null = null;
    let bestDiff = Infinity;

    for (const garmin of garminList) {
      const diff = Math.abs(parseEpoch(garmin.start_time) - hevyEpoch);
      if (diff <= 120 && diff < bestDiff) {
        bestDiff = diff;
        bestMatch = garmin;
      }
    }

    const sources: ActivitySource[] = [
      { platform: "hevy", source_id: hevy.source_id, manufacturer: null },
    ];
    if (bestMatch) {
      sources.push({
        platform: "garmin",
        source_id: bestMatch.source_id,
        manufacturer: bestMatch.manufacturer,
      });
      matchedGarminIds.add(bestMatch.source_id);
    }

    // Determine sync status from either source
    const syncStatus = hevy.sync_status || bestMatch?.sync_status || null;
    const syncedFrom = hevy.sync_status ? "hevy" : bestMatch?.sync_status ? "garmin" : null;

    mergedActivities.push({
      name: hevy.name,
      activity_type: hevy.activity_type,
      start_time: hevy.start_time,
      duration: hevy.duration,
      distance: bestMatch?.distance || hevy.distance,
      sources,
      sync_status: syncStatus as MergedActivity["sync_status"],
      destination_id: hevy.destination_id || bestMatch?.destination_id || null,
      synced_at: hevy.synced_at || bestMatch?.synced_at || null,
      synced_from: syncedFrom as MergedActivity["synced_from"],
    });
  }

  // Add unmatched Garmin activities
  for (const garmin of garminList) {
    if (matchedGarminIds.has(garmin.source_id)) continue;
    mergedActivities.push({
      name: garmin.name,
      activity_type: garmin.activity_type,
      start_time: garmin.start_time,
      duration: garmin.duration,
      distance: garmin.distance,
      sources: [{
        platform: "garmin",
        source_id: garmin.source_id,
        manufacturer: garmin.manufacturer,
      }],
      sync_status: garmin.sync_status as MergedActivity["sync_status"],
      destination_id: garmin.destination_id,
      synced_at: garmin.synced_at,
      synced_from: garmin.sync_status ? "garmin" : null,
    });
  }

  // Sort by start_time descending
  mergedActivities.sort((a, b) => (b.start_time || "").localeCompare(a.start_time || ""));

  return {
    credentials: credentials as unknown as PlatformCredential[],
    rules: rules as unknown as SyncRule[],
    syncLog: syncLog as unknown as SyncLogEntry[],
    syncServiceStatus: syncServiceStatus as unknown as SyncServiceStatus[],
    backfillProgress: backfillProgress as unknown as BackfillProgress[],
    dataCounts,
    syncRunLogs: syncRunLogs as unknown as any[],
    mergedActivities,
  };
}

function StatusBadge({ status, hint }: { status: string; hint?: string }) {
  if (status === "connected") {
    return (
      <Badge variant="default" className="bg-green-600 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Connected
      </Badge>
    );
  }
  if (status === "sync-service") {
    return (
      <Badge variant="default" className="bg-blue-600 text-xs">
        <Settings2 className="h-3 w-3 mr-1" />
        {hint || "Sync Service"}
      </Badge>
    );
  }
  if (status === "planned") {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        Coming soon
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      <XCircle className="h-3 w-3 mr-1" />
      Disconnected
    </Badge>
  );
}

export default async function ConnectionsPage() {
  const { credentials, rules, syncLog, syncServiceStatus, backfillProgress, dataCounts, syncRunLogs, mergedActivities } =
    await getPageData();

  const credMap = Object.fromEntries(
    credentials.map((c) => [c.platform, c])
  );

  const syncServiceMap = Object.fromEntries(
    syncServiceStatus.map((s) => [s.platform, s])
  );

  const platforms = ["garmin", "hevy", "strava", "surfr"];

  function getPlatformStatus(platform: string) {
    const config = platformConfig[platform];
    const cred = credMap[platform];
    const syncService = syncServiceMap[platform];

    if (config.connectionType === "planned") {
      return { isConnected: false, badgeStatus: "planned" as const, detail: null };
    }

    if (config.connectionType === "oauth") {
      const isConnected = cred?.status === "active" || cred?.status === "connected";
      return {
        isConnected,
        badgeStatus: isConnected ? "connected" as const : "disconnected" as const,
        detail: isConnected ? {
          name: cred?.athlete_name,
          date: cred?.connected_at,
        } : null,
      };
    }

    const hasData = syncService?.has_data;
    return {
      isConnected: !!hasData,
      badgeStatus: hasData ? "sync-service" as const : "disconnected" as const,
      detail: hasData ? {
        name: null,
        date: syncService?.last_sync,
      } : null,
    };
  }

  // Stats
  const connectedCount = platforms.filter((p) => getPlatformStatus(p).isConnected).length;
  const activeRulesCount = rules.filter((r) => r.enabled).length;
  const totalRecords = dataCounts.reduce((sum, d) => sum + Number(d.record_count), 0);
  const lastSyncTime = syncRunLogs.length > 0 ? new Date(syncRunLogs[0].started_at).toLocaleString() : null;

  // Build platform nodes for flow diagram
  const flowPlatforms = platforms.map((p) => {
    const { isConnected } = getPlatformStatus(p);
    const config = platformConfig[p];
    const syncService = syncServiceMap[p];
    return {
      platform: p,
      isConnected,
      connectionType: config.connectionType,
      lastSync: syncService?.last_sync ?? null,
    };
  });

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Section 1: Header + Stats Strip */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Sync Hub</h1>
        <p className="text-muted-foreground mt-1">
          Manage integrations, sync rules, and data pipeline
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Cable className="h-3.5 w-3.5" />
              Platforms
            </div>
            <p className="text-2xl font-bold">{connectedCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Route className="h-3.5 w-3.5" />
              Active Rules
            </div>
            <p className="text-2xl font-bold">{activeRulesCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Database className="h-3.5 w-3.5" />
              Total Records
            </div>
            <p className="text-2xl font-bold">{totalRecords.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Activity className="h-3.5 w-3.5" />
              Last Sync
            </div>
            <p className="text-sm font-medium mt-1">{lastSyncTime ?? "No syncs yet"}</p>
          </div>
        </div>
      </div>

      {/* Section 2: Sync Flow Diagram */}
      <div className="mb-8">
        <SyncFlowDiagram platforms={flowPlatforms} rules={rules} />
      </div>

      {/* Section 3: Platform Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {platforms.map((platform) => {
          const config = platformConfig[platform];
          const { isConnected, badgeStatus, detail } = getPlatformStatus(platform);
          const Icon = config.icon;

          return (
            <Card key={platform}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                      <Icon className="h-5 w-5 text-accent-foreground" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{config.label}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {config.description}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={badgeStatus} hint={config.connectionHint} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {isConnected && detail ? (
                      <div className="space-y-1">
                        {detail.name && (
                          <p>
                            <span className="text-foreground font-medium">{detail.name}</span>
                          </p>
                        )}
                        {detail.date && (
                          <p className="text-xs">
                            {config.connectionType === "sync-service" ? "Last synced" : "Connected"}{" "}
                            {new Date(detail.date).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    ) : config.connectionType === "planned" ? (
                      <p className="text-xs">{config.connectionHint}</p>
                    ) : (
                      <p>Not connected</p>
                    )}
                  </div>
                  <ConnectionActions
                    platform={platform}
                    isConnected={isConnected}
                    connectionType={config.connectionType}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Section 4: Activity Sync Manager */}
      <div className="mb-8">
        <ActivitySyncManager
          activities={mergedActivities}
          stravaConnected={getPlatformStatus("strava").isConnected}
        />
      </div>

      {/* Section 5: Sync Rules + Activity Log (side by side) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="lg:col-span-2">
          <SyncRulesManager initialRules={rules} />
        </div>
        <div>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base">Recent Sync Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {syncLog.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No sync activity yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {syncLog.slice(0, 8).map((entry, i) => (
                    <div
                      key={`${entry.source_platform}-${entry.destination}-${entry.status}-${i}`}
                      className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="capitalize font-medium truncate">{entry.source_platform}</span>
                        <span className="text-muted-foreground">&rarr;</span>
                        <span className="capitalize truncate">{entry.destination}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={
                            entry.status === "synced"
                              ? "default"
                              : entry.status === "pending"
                                ? "secondary"
                                : "outline"
                          }
                          className="text-xs"
                        >
                          {entry.count}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Section 6: Pipeline Operations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineOperations
            backfillProgress={backfillProgress}
            dataCounts={dataCounts}
            syncLogs={syncRunLogs}
          />
        </CardContent>
      </Card>
    </div>
  );
}
