"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DuplicateResolver } from "@/components/duplicate-resolver";
import {
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Database,
  HardDrive,
  GitMerge,
  BarChart3,
} from "lucide-react";

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

interface SyncLogEntry {
  id: number;
  sync_type: string;
  status: string;
  records_synced: number;
  started_at: string;
}

interface PipelineOperationsProps {
  backfillProgress: BackfillProgress[];
  dataCounts: DataCount[];
  syncLogs: SyncLogEntry[];
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

function BackfillStatusBadge({ status }: { status: string }) {
  const variant = status === "complete" ? "default" : status === "running" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-xs">
      {status}
    </Badge>
  );
}

function BackfillTab({ progress }: { progress: BackfillProgress[] }) {
  if (progress.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No backfill jobs started yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {progress.map((p) => {
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
                <BackfillStatusBadge status={p.status} />
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
      })}
    </div>
  );
}

function DataCoverageTab({ dataCounts }: { dataCounts: DataCount[] }) {
  const totalRecords = dataCounts.reduce((sum, d) => sum + Number(d.record_count), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">
            {totalRecords.toLocaleString()} total records
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
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
                {d.unique_dates != null ? Number(d.unique_dates).toLocaleString() : "\u2014"}
              </span>
              <span className="text-right font-mono text-muted-foreground">
                {d.unique_endpoints != null ? Number(d.unique_endpoints) : "\u2014"}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SyncRunsTab({ syncLogs }: { syncLogs: SyncLogEntry[] }) {
  if (syncLogs.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No sync runs recorded yet.
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-1">
          <div className="grid grid-cols-4 text-xs text-muted-foreground font-medium py-2 border-b border-border">
            <span>Type</span>
            <span>Status</span>
            <span className="text-right">Records</span>
            <span className="text-right">Time</span>
          </div>
          {syncLogs.map((log) => (
            <div
              key={log.id}
              className="grid grid-cols-4 text-sm py-2 border-b border-border/50 last:border-0"
            >
              <span className="font-medium">{log.sync_type}</span>
              <span>
                <BackfillStatusBadge status={log.status} />
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
  );
}

export function PipelineOperations({
  backfillProgress,
  dataCounts,
  syncLogs,
}: PipelineOperationsProps) {
  const [syncState, setSyncState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function triggerSync() {
    setSyncState("loading");
    try {
      const resp = await fetch("/api/sync", { method: "POST" });
      if (resp.ok || resp.status === 409) {
        setSyncState("done");
        setTimeout(() => setSyncState("idle"), 4000);
      } else {
        setSyncState("error");
        setTimeout(() => setSyncState("idle"), 4000);
      }
    } catch {
      setSyncState("error");
      setTimeout(() => setSyncState("idle"), 4000);
    }
  }

  const isDemo = process.env.NEXT_PUBLIC_IS_DEMO === "true";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isDemo ? "Demo mode — sync disabled" : "Auto-syncs every 4h via GitHub Actions"}
        </p>
        {!isDemo && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={triggerSync}
            disabled={syncState === "loading"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncState === "loading" ? "animate-spin" : ""}`} />
            {syncState === "loading" ? "Triggering…" : syncState === "done" ? "Triggered!" : syncState === "error" ? "Failed" : "Sync Now"}
          </Button>
        )}
      </div>
    <Tabs defaultValue="backfill" className="w-full">
      <TabsList variant="line" className="w-full justify-start">
        <TabsTrigger value="backfill" className="gap-1.5">
          <HardDrive className="h-3.5 w-3.5" />
          Backfill
        </TabsTrigger>
        <TabsTrigger value="duplicates" className="gap-1.5">
          <GitMerge className="h-3.5 w-3.5" />
          Duplicates
        </TabsTrigger>
        <TabsTrigger value="coverage" className="gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" />
          Data Coverage
        </TabsTrigger>
        <TabsTrigger value="runs" className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Sync Runs
        </TabsTrigger>
      </TabsList>

      <TabsContent value="backfill" className="mt-4">
        <BackfillTab progress={backfillProgress} />
      </TabsContent>

      <TabsContent value="duplicates" className="mt-4">
        <DuplicateResolver />
      </TabsContent>

      <TabsContent value="coverage" className="mt-4">
        <DataCoverageTab dataCounts={dataCounts} />
      </TabsContent>

      <TabsContent value="runs" className="mt-4">
        <SyncRunsTab syncLogs={syncLogs} />
      </TabsContent>
    </Tabs>
    </div>
  );
}
