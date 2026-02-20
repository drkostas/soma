import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import {
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Database,
} from "lucide-react";

export const revalidate = 30; // Refresh every 30 seconds for status page

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

async function getBackfillProgress(): Promise<BackfillProgress[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM backfill_progress ORDER BY source
  `;
  return rows as unknown as BackfillProgress[];
}

async function getDataCounts(): Promise<DataCount[]> {
  const sql = getDb();

  const garminDaily = await sql`
    SELECT COUNT(*) as count, COUNT(DISTINCT date) as dates, COUNT(DISTINCT endpoint_name) as endpoints
    FROM garmin_raw_data
  `;
  const garminActivity = await sql`
    SELECT COUNT(*) as count, COUNT(DISTINCT activity_id) as activities
    FROM garmin_activity_raw
  `;
  const garminProfile = await sql`
    SELECT COUNT(*) as count FROM garmin_profile_raw
  `;
  const hevy = await sql`
    SELECT COUNT(*) as count,
      COUNT(DISTINCT endpoint_name) as endpoints
    FROM hevy_raw_data
  `;
  const healthSummary = await sql`
    SELECT COUNT(*) as count FROM daily_health_summary
  `;
  const weight = await sql`
    SELECT COUNT(*) as count FROM weight_log
  `;
  const sleep = await sql`
    SELECT COUNT(*) as count FROM sleep_detail
  `;

  return [
    {
      table_name: "Garmin Daily (raw)",
      record_count: garminDaily[0]?.count ?? 0,
      unique_dates: garminDaily[0]?.dates ?? 0,
      unique_endpoints: garminDaily[0]?.endpoints ?? 0,
    },
    {
      table_name: "Garmin Activities (raw)",
      record_count: garminActivity[0]?.count ?? 0,
      unique_dates: garminActivity[0]?.activities ?? 0,
    },
    {
      table_name: "Garmin Profile (raw)",
      record_count: garminProfile[0]?.count ?? 0,
    },
    {
      table_name: "Hevy (raw)",
      record_count: hevy[0]?.count ?? 0,
      unique_endpoints: hevy[0]?.endpoints ?? 0,
    },
    {
      table_name: "Health Summary (L2)",
      record_count: healthSummary[0]?.count ?? 0,
    },
    {
      table_name: "Weight Log (L2)",
      record_count: weight[0]?.count ?? 0,
    },
    {
      table_name: "Sleep Detail (L2)",
      record_count: sleep[0]?.count ?? 0,
    },
  ];
}

async function getRecentSyncLogs() {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM sync_log
    ORDER BY started_at DESC
    LIMIT 10
  `;
  return rows;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 className="h-4 w-4 text-green-400" />;
    case "running":
      return <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />;
    case "pending":
      return <Clock className="h-4 w-4 text-yellow-400" />;
    default:
      return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "complete" ? "default" : status === "running" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-xs">
      {status}
    </Badge>
  );
}

export default async function StatusPage() {
  const [progress, dataCounts, syncLogs] = await Promise.all([
    getBackfillProgress(),
    getDataCounts(),
    getRecentSyncLogs(),
  ]);

  const totalRecords = dataCounts.reduce((sum, d) => sum + Number(d.record_count), 0);

  return (
    <div className="container mx-auto px-6 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Sync Status</h1>
        <p className="text-muted-foreground mt-1">
          Data pipeline progress and coverage
        </p>
      </div>

      {/* Backfill Progress Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {progress.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-8 text-center text-muted-foreground">
              No backfill jobs started yet.
            </CardContent>
          </Card>
        ) : (
          progress.map((p) => {
            const pct =
              p.total_items > 0
                ? Math.round((p.items_completed / p.total_items) * 100)
                : 0;
            const remaining = p.total_items - p.items_completed;

            return (
              <Card key={p.source}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={p.status} />
                      <CardTitle className="text-base font-semibold">
                        {p.source.replace(/_/g, " ")}
                      </CardTitle>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Progress value={pct} className="h-2" />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {p.items_completed.toLocaleString()} / {p.total_items.toLocaleString()}
                    </span>
                    <span className="font-medium">{pct}%</span>
                  </div>
                  {p.oldest_date_done && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Oldest date</span>
                      <span className="font-mono text-xs">
                        {new Date(p.oldest_date_done).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {p.status === "running" && remaining > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Remaining</span>
                      <span>{remaining.toLocaleString()} items</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Last updated</span>
                    <span className="font-mono text-xs">
                      {new Date(p.updated_at).toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Data Coverage Table */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">
              Data Coverage — {totalRecords.toLocaleString()} total records
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {/* Header */}
            <div className="grid grid-cols-4 text-xs text-muted-foreground font-medium py-2 border-b border-border">
              <span>Table</span>
              <span className="text-right">Records</span>
              <span className="text-right">Unique Items</span>
              <span className="text-right">Endpoints</span>
            </div>
            {dataCounts.map((d) => (
              <div
                key={d.table_name}
                className="grid grid-cols-4 text-sm py-2 border-b border-border/50 last:border-0"
              >
                <span className="font-medium">{d.table_name}</span>
                <span className="text-right font-mono">
                  {Number(d.record_count).toLocaleString()}
                </span>
                <span className="text-right font-mono text-muted-foreground">
                  {d.unique_dates != null ? Number(d.unique_dates).toLocaleString() : "—"}
                </span>
                <span className="text-right font-mono text-muted-foreground">
                  {d.unique_endpoints != null ? Number(d.unique_endpoints) : "—"}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Sync Logs */}
      {syncLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Sync Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="grid grid-cols-4 text-xs text-muted-foreground font-medium py-2 border-b border-border">
                <span>Type</span>
                <span>Status</span>
                <span className="text-right">Records</span>
                <span className="text-right">Time</span>
              </div>
              {syncLogs.map((log: any) => (
                <div
                  key={log.id}
                  className="grid grid-cols-4 text-sm py-2 border-b border-border/50 last:border-0"
                >
                  <span className="font-medium">{log.sync_type}</span>
                  <span>
                    <StatusBadge status={log.status} />
                  </span>
                  <span className="text-right font-mono">
                    {log.records_synced}
                  </span>
                  <span className="text-right font-mono text-xs text-muted-foreground">
                    {new Date(log.started_at).toLocaleString()}
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
