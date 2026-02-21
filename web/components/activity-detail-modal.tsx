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
import { ActivityPerformanceChart } from "@/components/activity-performance-chart";

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
  const gear = data?.gear;

  const typeKey = summary?.activityType?.typeKey || "";
  const isRunning = typeKey === "running" || typeKey === "treadmill_running";
  const isStrength = typeKey === "strength_training";

  const laps = splits?.lapDTOs || [];
  const hasLaps = laps.length > 0 && laps[0]?.distance > 0;
  const shoeInfo = Array.isArray(gear) ? gear.find((g: any) => g.gearTypeName === "Shoes") : null;
  const hasTimeSeries = isRunning && Array.isArray(data?.time_series) && data.time_series.length > 0;

  return (
    <Sheet open={!!activityId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl">
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
            <TabsList className={`grid w-full ${hasTimeSeries ? "grid-cols-4" : "grid-cols-3"}`}>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              {hasTimeSeries && <TabsTrigger value="performance">Performance</TabsTrigger>}
              {hasLaps && <TabsTrigger value="splits">Splits</TabsTrigger>}
              {!hasLaps && <TabsTrigger value="splits" disabled>Splits</TabsTrigger>}
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            <ScrollArea className="h-[calc(100vh-180px)] mt-4">
              <TabsContent value="overview" className="space-y-4 px-4 pb-8">
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
                          {typeKey.includes("kite") || typeKey.includes("wind")
                            ? `${(weather.windSpeed * 0.868976).toFixed(1)} kts`
                            : `${weather.windSpeed} mph`}
                          {weather.windDirectionCompassPoint && ` ${weather.windDirectionCompassPoint.toUpperCase()}`}
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

                {/* Gear Info */}
                {shoeInfo && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gear</h4>
                    <div className="flex items-center gap-3 p-2.5 bg-muted/30 rounded-lg">
                      <span className="text-lg">👟</span>
                      <div>
                        <div className="text-sm font-medium">
                          {shoeInfo.customMakeModel || shoeInfo.displayName || "Unknown Shoe"}
                        </div>
                        {shoeInfo.maximumMeters > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {Math.round(shoeInfo.maximumMeters / 1000)} km max life
                            <span className={`ml-2 ${shoeInfo.gearStatusName === "active" ? "text-green-400" : "text-muted-foreground"}`}>
                              {shoeInfo.gearStatusName}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Running Dynamics Summary */}
                {isRunning && summary.avgGroundContactTime > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Running Dynamics</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {summary.avgGroundContactTime > 0 && (
                        <MetricBox label="Ground Contact" value={`${Math.round(summary.avgGroundContactTime)} ms`} />
                      )}
                      {summary.avgVerticalOscillation > 0 && (
                        <MetricBox label="Vert Oscillation" value={`${Number(summary.avgVerticalOscillation).toFixed(1)} cm`} />
                      )}
                      {summary.avgVerticalRatio > 0 && (
                        <MetricBox label="Vert Ratio" value={`${Number(summary.avgVerticalRatio).toFixed(1)}%`} />
                      )}
                      {summary.averagePower > 0 && (
                        <MetricBox label="Avg Power" value={`${Math.round(summary.averagePower)} W`} />
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              {hasTimeSeries && (
                <TabsContent value="performance" className="px-4 pb-8">
                  <ActivityPerformanceChart timeSeries={data.time_series} />
                </TabsContent>
              )}

              <TabsContent value="splits" className="px-4 pb-8">
                {hasLaps && (
                  <div className="space-y-4">
                    {/* Visual pace bars */}
                    {isRunning && (() => {
                      const paceData = laps
                        .filter((l: any) => l.averageSpeed > 0 && l.distance > 0)
                        .map((l: any) => ({
                          pace: 1000 / l.averageSpeed / 60,
                          hr: l.averageHR,
                        }));
                      if (paceData.length < 2) return null;
                      const minPace = Math.min(...paceData.map((p: any) => p.pace));
                      const maxPace = Math.max(...paceData.map((p: any) => p.pace));
                      const range = maxPace - minPace || 1;
                      const avgPace = paceData.reduce((s: number, p: any) => s + p.pace, 0) / paceData.length;
                      return (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                            <span>Pace per Split</span>
                            <span>avg {formatPace(avgPace * 60)}/km</span>
                          </div>
                          <div className="flex items-end gap-[3px] h-24">
                            {paceData.map((p: any, i: number) => {
                              const normalized = 1 - (p.pace - minPace) / range;
                              const h = 20 + normalized * 80;
                              const isFast = p.pace < avgPace * 0.97;
                              const isSlow = p.pace > avgPace * 1.03;
                              return (
                                <div
                                  key={i}
                                  className={`flex-1 rounded-t-sm ${
                                    isFast ? "bg-green-500/70" : isSlow ? "bg-red-500/50" : "bg-primary/50"
                                  }`}
                                  style={{ height: `${h}%` }}
                                  title={`Split ${i + 1}: ${formatPace(p.pace * 60)}/km`}
                                />
                              );
                            })}
                          </div>
                          <div className="flex justify-between text-[9px] text-muted-foreground">
                            <span>{formatPace(minPace * 60)}/km</span>
                            <span>{formatPace(maxPace * 60)}/km</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card-based splits */}
                    {(() => {
                      const paces = laps
                        .filter((l: any) => l.averageSpeed > 0 && l.distance > 0)
                        .map((l: any) => 1000 / l.averageSpeed / 60);
                      const avgPace = paces.length > 0
                        ? paces.reduce((s: number, p: number) => s + p, 0) / paces.length
                        : 0;

                      return (
                        <>
                          <div className="space-y-1">
                            {laps.map((lap: any, i: number) => {
                              const pace = lap.averageSpeed > 0 ? formatPace(lap.averageSpeed) : "—";
                              const paceVal = lap.averageSpeed > 0 ? 1000 / lap.averageSpeed / 60 : 0;
                              const isFast = paceVal > 0 && avgPace > 0 && paceVal < avgPace * 0.97;
                              const isSlow = paceVal > 0 && avgPace > 0 && paceVal > avgPace * 1.03;
                              const paceColor = isFast ? "text-green-400" : isSlow ? "text-red-400" : "text-foreground";

                              return (
                                <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/30">
                                  {/* Split number */}
                                  <div className="w-7 text-center shrink-0">
                                    <span className="text-base font-bold">{i + 1}</span>
                                  </div>

                                  {/* Main metrics */}
                                  <div className="flex-1 grid grid-cols-3 gap-x-3">
                                    <div>
                                      <div className={`text-sm font-bold ${paceColor}`}>{pace}/km</div>
                                      <div className="text-[10px] text-muted-foreground">Pace</div>
                                    </div>
                                    <div>
                                      <div className="text-sm font-medium">
                                        {lap.averageHR > 0 ? `${Math.round(lap.averageHR)}` : "—"}
                                        {lap.averageHR > 0 && <span className="text-[10px] text-muted-foreground ml-0.5">bpm</span>}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">HR</div>
                                    </div>
                                    <div>
                                      <div className="text-sm text-muted-foreground">
                                        {lap.duration > 0 ? formatDur(lap.duration / 1000) : "—"}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">Time</div>
                                    </div>
                                  </div>

                                  {/* Optional secondary metrics (elevation, cadence) shown small */}
                                  <div className="w-16 text-right shrink-0 space-y-0.5">
                                    {lap.elevationGain > 0 && (
                                      <div className="text-[10px] text-muted-foreground">+{Math.round(lap.elevationGain)}m</div>
                                    )}
                                    {lap.averageRunCadence > 0 && (
                                      <div className="text-[10px] text-muted-foreground">{Math.round(lap.averageRunCadence)} spm</div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Summary footer */}
                          <div className="flex items-center justify-between pt-3 mt-2 border-t border-border">
                            <div className="text-xs text-muted-foreground">{laps.length} splits</div>
                            <div className="flex gap-4 text-xs">
                              <span className="font-medium">{summary?.averageSpeed > 0 ? `${formatPace(summary.averageSpeed)}/km avg` : ""}</span>
                              <span className="text-muted-foreground">{summary?.averageHR > 0 ? `${Math.round(summary.averageHR)} bpm avg` : ""}</span>
                              <span className="text-muted-foreground">{summary?.duration > 0 ? formatDur(summary.duration) : ""}</span>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="details" className="space-y-4 px-4 pb-8">
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
