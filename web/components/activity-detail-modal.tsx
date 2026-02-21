"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ActivityDetailModalProps {
  activityId: string | null;
  onClose: () => void;
}

function formatPace(speedMs: number) {
  if (!speedMs || speedMs <= 0) return "—";
  const paceMin = 1000 / speedMs / 60;
  const m = Math.floor(paceMin);
  const s = Math.round((paceMin - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDur(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ActivityDetailModal({ activityId, onClose }: ActivityDetailModalProps) {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activityId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/activity/${activityId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [activityId]);

  const summary = data?.summary;
  const splits = data?.splits;
  const weather = data?.weather;
  const hrZones = data?.hr_zones;

  const typeKey = summary?.activityType?.typeKey || "";
  const isRunning = typeKey === "running";
  const isStrength = typeKey === "strength_training";

  const laps = splits?.lapDTOs || [];
  const hasLaps = laps.length > 0 && laps[0]?.distance > 0;

  return (
    <Sheet open={!!activityId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-lg">
            {loading ? "Loading..." : summary?.activityName || "Activity"}
          </SheetTitle>
          {summary && (
            <div className="text-sm text-muted-foreground">
              {new Date(summary.startTimeLocal).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          )}
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading activity data...
          </div>
        )}

        {!loading && summary && (
          <Tabs defaultValue="overview" className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              {hasLaps && <TabsTrigger value="splits">Splits</TabsTrigger>}
              {!hasLaps && <TabsTrigger value="splits" disabled>Splits</TabsTrigger>}
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            <ScrollArea className="h-[calc(100vh-200px)] mt-4">
              <TabsContent value="overview" className="space-y-4 pr-4">
                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {summary.distance > 0 && (
                    <MetricBox label="Distance" value={`${(summary.distance / 1000).toFixed(2)} km`} />
                  )}
                  <MetricBox label="Duration" value={formatDur(summary.duration)} />
                  {isRunning && summary.distance > 0 && (
                    <MetricBox
                      label="Avg Pace"
                      value={`${formatPace(summary.averageSpeed)}/km`}
                    />
                  )}
                  {summary.averageHR > 0 && (
                    <MetricBox label="Avg HR" value={`${Math.round(summary.averageHR)} bpm`} />
                  )}
                  {summary.maxHR > 0 && (
                    <MetricBox label="Max HR" value={`${Math.round(summary.maxHR)} bpm`} />
                  )}
                  {summary.calories > 0 && (
                    <MetricBox label="Calories" value={`${Math.round(summary.calories)} kcal`} />
                  )}
                  {summary.elevationGain > 0 && (
                    <MetricBox label="Elev Gain" value={`${Math.round(summary.elevationGain)}m`} />
                  )}
                  {summary.elevationLoss > 0 && (
                    <MetricBox label="Elev Loss" value={`${Math.round(summary.elevationLoss)}m`} />
                  )}
                  {isRunning && summary.averageRunningCadenceInStepsPerMinute > 0 && (
                    <MetricBox label="Cadence" value={`${Math.round(summary.averageRunningCadenceInStepsPerMinute)} spm`} />
                  )}
                  {isRunning && summary.avgStrideLength > 0 && (
                    <MetricBox label="Stride" value={`${Math.round(summary.avgStrideLength)} cm`} />
                  )}
                  {summary.vO2MaxValue > 0 && (
                    <MetricBox label="VO2max" value={`${summary.vO2MaxValue}`} />
                  )}
                  {summary.aerobicTrainingEffect > 0 && (
                    <MetricBox label="Aerobic TE" value={`${Number(summary.aerobicTrainingEffect).toFixed(1)}`} />
                  )}
                  {!isRunning && !isStrength && summary.maxSpeed > 0 && (
                    <MetricBox
                      label="Max Speed"
                      value={
                        typeKey.includes("kite")
                          ? `${(summary.maxSpeed * 1.94384).toFixed(1)} kts`
                          : `${(summary.maxSpeed * 3.6).toFixed(1)} km/h`
                      }
                    />
                  )}
                </div>

                {/* HR Zones */}
                {hrZones && Array.isArray(hrZones) && hrZones.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">HR Zones</h4>
                    {hrZones.map((z: any) => {
                      const totalSecs = hrZones.reduce((s: number, zz: any) => s + (zz.secsInZone || 0), 0);
                      const pct = totalSecs > 0 ? ((z.secsInZone || 0) / totalSecs) * 100 : 0;
                      const colors = ["bg-slate-400", "bg-blue-400", "bg-green-400", "bg-orange-400", "bg-red-400"];
                      return (
                        <div key={z.zoneNumber} className="flex items-center gap-2 text-xs">
                          <span className="w-8 text-muted-foreground">Z{z.zoneNumber}</span>
                          <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full ${colors[z.zoneNumber - 1] || "bg-primary"} rounded-full`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-12 text-right">{formatDur(z.secsInZone || 0)}</span>
                          <span className="w-8 text-right text-muted-foreground">{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Weather */}
                {weather && weather.temp && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Weather</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Temp: </span>
                        {Math.round((weather.temp - 32) * 5/9)}°C
                      </div>
                      {weather.relativeHumidity && (
                        <div>
                          <span className="text-muted-foreground">Humidity: </span>
                          {weather.relativeHumidity}%
                        </div>
                      )}
                      {weather.windSpeed > 0 && (
                        <div>
                          <span className="text-muted-foreground">Wind: </span>
                          {weather.windSpeed} mph {weather.windDirectionCompassPoint?.toUpperCase()}
                        </div>
                      )}
                      {weather.weatherTypeDTO?.desc && (
                        <div>
                          <span className="text-muted-foreground">Condition: </span>
                          {weather.weatherTypeDTO.desc}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="splits" className="pr-4">
                {hasLaps && (
                  <div className="space-y-1">
                    <div className="grid grid-cols-5 text-xs text-muted-foreground font-medium py-1 border-b border-border">
                      <span>Lap</span>
                      <span className="text-right">Pace</span>
                      <span className="text-right">HR</span>
                      <span className="text-right">Elev</span>
                      <span className="text-right">Cadence</span>
                    </div>
                    {laps.map((lap: any, i: number) => {
                      const pace = lap.averageSpeed > 0 ? formatPace(lap.averageSpeed) : "—";
                      return (
                        <div key={i} className="grid grid-cols-5 text-sm py-1.5 border-b border-border/30">
                          <span className="text-muted-foreground">
                            {lap.distance > 0 ? `${(lap.distance / 1000).toFixed(1)} km` : `#${i + 1}`}
                          </span>
                          <span className="text-right font-medium">{pace}</span>
                          <span className="text-right">
                            {lap.averageHR > 0 ? `${Math.round(lap.averageHR)}` : "—"}
                          </span>
                          <span className="text-right text-muted-foreground">
                            {lap.elevationGain > 0 ? `+${Math.round(lap.elevationGain)}m` : "—"}
                          </span>
                          <span className="text-right text-muted-foreground">
                            {lap.averageRunCadence > 0 ? `${Math.round(lap.averageRunCadence)}` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="details" className="space-y-4 pr-4">
                {/* All raw summary fields */}
                <div className="space-y-1">
                  {Object.entries(summary)
                    .filter(([k, v]) =>
                      v !== null && v !== 0 && v !== "" &&
                      typeof v !== "object" &&
                      !["activityUUID", "userProfilePK", "deviceId"].includes(k)
                    )
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between text-xs py-0.5">
                        <span className="text-muted-foreground truncate mr-2">
                          {key.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        <span className="font-mono shrink-0">
                          {typeof value === "number" ? Number(value).toFixed(2) : String(value)}
                        </span>
                      </div>
                    ))}
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/50 rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}
