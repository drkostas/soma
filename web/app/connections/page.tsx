import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { ConnectionActions } from "@/components/connection-actions";
import { SyncRulesManager } from "@/components/sync-rules-manager";
import {
  CheckCircle2,
  XCircle,
  Watch,
  Dumbbell,
  Bike,
  Wind,
} from "lucide-react";

export const revalidate = 30;

const platformConfig: Record<
  string,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  garmin: {
    label: "Garmin Connect",
    description: "Fitness watch data, daily health, activities",
    icon: Watch,
  },
  hevy: {
    label: "Hevy",
    description: "Strength training workouts and exercises",
    icon: Dumbbell,
  },
  strava: {
    label: "Strava",
    description: "Activity sharing and social fitness",
    icon: Bike,
  },
  surfr: {
    label: "Surfr",
    description: "Kitesurf sessions and jump analytics",
    icon: Wind,
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

async function getConnectionData() {
  const sql = getDb();

  const [credentials, rules, syncLog] = await Promise.all([
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
  ]);

  return {
    credentials: credentials as unknown as PlatformCredential[],
    rules: rules as unknown as SyncRule[],
    syncLog: syncLog as unknown as SyncLogEntry[],
  };
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <Badge variant="default" className="bg-green-600 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Connected
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
  const { credentials, rules, syncLog } = await getConnectionData();

  const credMap = Object.fromEntries(
    credentials.map((c) => [c.platform, c])
  );

  const platforms = ["garmin", "hevy", "strava", "surfr"];

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Connections</h1>
        <p className="text-muted-foreground mt-1">
          Manage platform integrations and sync rules
        </p>
      </div>

      {/* Platform Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {platforms.map((platform) => {
          const config = platformConfig[platform];
          const cred = credMap[platform];
          const isConnected = cred?.status === "connected";
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
                  <StatusBadge status={isConnected ? "connected" : "disconnected"} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {isConnected ? (
                      <div className="space-y-1">
                        {cred.athlete_name && (
                          <p>
                            <span className="text-foreground font-medium">{cred.athlete_name}</span>
                          </p>
                        )}
                        {cred.connected_at && (
                          <p className="text-xs">
                            Connected {new Date(cred.connected_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p>Not connected</p>
                    )}
                  </div>
                  <ConnectionActions platform={platform} isConnected={isConnected} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Sync Rules */}
      <div className="mb-8">
        <SyncRulesManager initialRules={rules} />
      </div>

      {/* Sync Activity Log */}
      {syncLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Sync Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="grid grid-cols-5 text-xs text-muted-foreground font-medium py-2 border-b border-border">
                <span>Source</span>
                <span>Destination</span>
                <span>Status</span>
                <span className="text-right">Count</span>
                <span className="text-right">Last Sync</span>
              </div>
              {syncLog.map((entry, i) => (
                <div
                  key={`${entry.source_platform}-${entry.destination}-${entry.status}-${i}`}
                  className="grid grid-cols-5 text-sm py-2 border-b border-border/50 last:border-0"
                >
                  <span className="font-medium capitalize">{entry.source_platform}</span>
                  <span className="capitalize">{entry.destination}</span>
                  <span>
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
                      {entry.status}
                    </Badge>
                  </span>
                  <span className="text-right font-mono">{entry.count}</span>
                  <span className="text-right font-mono text-xs text-muted-foreground">
                    {entry.last_sync
                      ? new Date(entry.last_sync).toLocaleString()
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
