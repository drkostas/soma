"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { AlertTriangle, Check, ChevronRight, Eye, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Activity {
  id: number;
  name: string;
  type: string;
  startTime: string;
  duration: number;
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  detailEndpoints: number;
}

interface DupPair {
  a: Activity;
  b: Activity;
}

type FieldKey = "name" | "type" | "startTime" | "duration" | "distance" | "calories" | "hr";

function formatDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatDistance(m: number): string {
  if (!m) return "0 km";
  return `${(m / 1000).toFixed(1)} km`;
}

function formatTime(ts: string): string {
  const d = new Date(ts + "Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatSpeed(mps: number): string {
  if (!mps) return "—";
  const kph = mps * 3.6;
  return `${kph.toFixed(1)} km/h`;
}

function formatPace(mps: number): string {
  if (!mps) return "—";
  const minPerKm = 1000 / mps / 60;
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")} /km`;
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-mono">{value}</span>
    </div>
  );
}

function ActivityDetailSheet({
  activityId,
  open,
  onOpenChange,
}: {
  activityId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activityId || !open) return;
    setLoading(true);
    setDetail(null);
    fetch(`/api/activity/${activityId}`)
      .then((r) => r.json())
      .then((d) => setDetail(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activityId, open]);

  const summary = detail?.summary;
  const splits = detail?.splits;
  const hrZones = detail?.hr_zones;
  const weather = detail?.weather;
  const gear = detail?.gear;
  const exerciseSets = detail?.exercise_sets;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">
            {summary?.activityName || `Activity ${activityId}`}
          </SheetTitle>
          <SheetDescription>
            {summary?.activityType?.typeKey?.replace(/_/g, " ") || "Activity"} — ID {activityId}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading details...
          </div>
        )}

        {!loading && !summary && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No detail data available for this activity.
          </div>
        )}

        {!loading && summary && (
          <div className="space-y-5 px-4 pb-6">
            {/* Core Metrics */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Summary</h4>
              <DetailRow label="Start Time" value={summary.startTimeLocal ? formatTime(summary.startTimeLocal) : undefined} />
              <DetailRow label="Duration" value={summary.duration ? formatDuration(summary.duration) : undefined} />
              <DetailRow label="Distance" value={summary.distance ? formatDistance(summary.distance) : undefined} />
              <DetailRow label="Calories" value={summary.calories ? `${Math.round(summary.calories)} kcal` : undefined} />
              <DetailRow label="Avg Speed" value={summary.averageSpeed ? formatSpeed(summary.averageSpeed) : undefined} />
              <DetailRow label="Max Speed" value={summary.maxSpeed ? formatSpeed(summary.maxSpeed) : undefined} />
              {summary.averageSpeed > 0 && summary.distance > 1000 && (
                <DetailRow label="Avg Pace" value={formatPace(summary.averageSpeed)} />
              )}
              <DetailRow label="Elevation Gain" value={summary.elevationGain ? `${Math.round(summary.elevationGain)} m` : undefined} />
              <DetailRow label="Avg HR" value={summary.averageHR ? `${Math.round(summary.averageHR)} bpm` : undefined} />
              <DetailRow label="Max HR" value={summary.maxHR ? `${Math.round(summary.maxHR)} bpm` : undefined} />
              {summary.averageSwolf != null && (
                <DetailRow label="Avg SWOLF" value={String(Math.round(summary.averageSwolf))} />
              )}
            </div>

            {/* HR Zones */}
            {hrZones && Array.isArray(hrZones) && hrZones.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">HR Zones</h4>
                {hrZones.map((z: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <span className="text-xs text-muted-foreground w-14">
                      Z{z.zoneNumber ?? i + 1}
                    </span>
                    <div className="flex-1 h-3 bg-accent rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/70 rounded-full"
                        style={{ width: `${Math.min(100, ((z.secsInZone || 0) / (summary.duration || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono w-12 text-right">
                      {formatDuration(z.secsInZone || 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Splits */}
            {splits && Array.isArray(splits.lapDTOs) && splits.lapDTOs.length > 1 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Splits ({splits.lapDTOs.length})
                </h4>
                <div className="grid grid-cols-[40px_1fr_1fr_1fr] gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">#</span>
                  <span className="text-muted-foreground font-medium">Distance</span>
                  <span className="text-muted-foreground font-medium">Time</span>
                  <span className="text-muted-foreground font-medium">Pace</span>
                  {splits.lapDTOs.map((lap: any, i: number) => (
                    <div key={i} className="contents">
                      <span className="font-mono text-muted-foreground">{i + 1}</span>
                      <span className="font-mono">{formatDistance(lap.distance || 0)}</span>
                      <span className="font-mono">{formatDuration(lap.duration || 0)}</span>
                      <span className="font-mono">
                        {lap.averageSpeed ? formatPace(lap.averageSpeed) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Exercise Sets (strength) */}
            {exerciseSets?.exerciseSets && Array.isArray(exerciseSets.exerciseSets) && exerciseSets.exerciseSets.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Exercises ({exerciseSets.exerciseSets.length} sets)
                </h4>
                {exerciseSets.exerciseSets.slice(0, 20).map((set: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-border/20 last:border-0">
                    <span className="text-muted-foreground truncate max-w-[200px]">
                      {set.exercises?.[0]?.category?.replace(/_/g, " ") || `Set ${i + 1}`}
                    </span>
                    <span className="font-mono">
                      {set.exercises?.[0]?.sets?.[0]?.weight
                        ? `${set.exercises[0].sets[0].weight}kg × ${set.exercises[0].sets[0].repetitionCount}`
                        : formatDuration(set.duration || 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Weather */}
            {weather && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Weather</h4>
                <DetailRow label="Conditions" value={weather.weatherTypeDTO?.desc} />
                <DetailRow label="Temperature" value={weather.temp != null ? `${Math.round((weather.temp - 32) * 5 / 9)}°C / ${Math.round(weather.temp)}°F` : undefined} />
                <DetailRow label="Wind" value={weather.windSpeed != null ? `${(weather.windSpeed * 3.6).toFixed(0)} km/h` : undefined} />
                {weather.windGust != null && weather.windGust > weather.windSpeed && (
                  <DetailRow label="Gusts" value={`${(weather.windGust * 3.6).toFixed(0)} km/h`} />
                )}
              </div>
            )}

            {/* Gear */}
            {gear && Array.isArray(gear) && gear.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Gear</h4>
                {gear.map((g: any, i: number) => (
                  <div key={i} className="text-sm py-1">
                    {g.displayName || g.customMakeModel || "Unknown gear"}
                  </div>
                ))}
              </div>
            )}

            {/* Available Endpoints */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Available Data</h4>
              <div className="flex flex-wrap gap-1">
                {Object.keys(detail)
                  .filter((k) => k !== "time_series" && detail[k] != null)
                  .map((k) => (
                    <Badge key={k} variant="outline" className="text-[10px]">
                      {k.replace(/_/g, " ")}
                    </Badge>
                  ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Auto-pick the "better" value for each field
function autoSelect(a: Activity, b: Activity): Record<FieldKey, "a" | "b"> {
  return {
    name: (a.name && !a.name.includes("Traditional") && !a.name.includes("Untitled")) ? "a" : "b",
    type: "a", // default to first
    startTime: "a",
    duration: a.duration >= b.duration ? "a" : "b",
    distance: a.distance >= b.distance ? "a" : "b",
    calories: (a.calories || 0) >= (b.calories || 0) ? "a" : "b",
    hr: (a.avgHr || 0) >= (b.avgHr || 0) ? "a" : "b",
  };
}

function FieldRow({
  label,
  valueA,
  valueB,
  selected,
  onSelect,
}: {
  label: string;
  valueA: string;
  valueB: string;
  selected: "a" | "b";
  onSelect: (side: "a" | "b") => void;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr_1fr] gap-2 items-center py-2 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <button
        onClick={() => onSelect("a")}
        className={cn(
          "text-sm px-3 py-1.5 rounded-md text-left transition-all",
          selected === "a"
            ? "bg-primary/15 text-primary ring-1 ring-primary/30 font-medium"
            : "hover:bg-accent/50 text-muted-foreground"
        )}
      >
        {valueA || "—"}
      </button>
      <button
        onClick={() => onSelect("b")}
        className={cn(
          "text-sm px-3 py-1.5 rounded-md text-left transition-all",
          selected === "b"
            ? "bg-primary/15 text-primary ring-1 ring-primary/30 font-medium"
            : "hover:bg-accent/50 text-muted-foreground"
        )}
      >
        {valueB || "—"}
      </button>
    </div>
  );
}

export function DuplicateResolver() {
  const [pairs, setPairs] = useState<DupPair[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selections, setSelections] = useState<Record<FieldKey, "a" | "b">>({} as any);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(0);
  const [sheetActivityId, setSheetActivityId] = useState<number | null>(null);

  const fetchDuplicates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/duplicates");
      const data = await res.json();
      setPairs(data.pairs || []);
      if (data.pairs?.length > 0) {
        setSelections(autoSelect(data.pairs[0].a, data.pairs[0].b));
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDuplicates(); }, [fetchDuplicates]);

  const pair = pairs[currentIndex];

  const handleSelect = (field: FieldKey, side: "a" | "b") => {
    setSelections((s) => ({ ...s, [field]: side }));
  };

  const goNext = () => {
    const next = currentIndex + 1;
    setCurrentIndex(next);
    if (next < pairs.length) {
      setSelections(autoSelect(pairs[next].a, pairs[next].b));
    }
  };

  const handleSkip = () => goNext();

  const handleResolve = async () => {
    if (!pair) return;
    setResolving(true);

    // Determine survivor: the one with more detail endpoints, or "a" by default
    const survivorSide = pair.a.detailEndpoints >= pair.b.detailEndpoints ? "a" : "b";
    const survivor = survivorSide === "a" ? pair.a : pair.b;
    const toDelete = survivorSide === "a" ? pair.b : pair.a;

    // Build merged fields — pick from whichever side was selected
    const pick = (field: FieldKey) => selections[field] || "a";
    const srcA = pair.a;
    const srcB = pair.b;
    const mergedFields: any = {};

    const nameFrom = pick("name") === "a" ? srcA : srcB;
    mergedFields.activityName = nameFrom.name;

    const typeFrom = pick("type") === "a" ? srcA : srcB;
    mergedFields.activityType = { typeKey: typeFrom.type };

    const timeFrom = pick("startTime") === "a" ? srcA : srcB;
    mergedFields.startTimeGMT = timeFrom.startTime;

    const durFrom = pick("duration") === "a" ? srcA : srcB;
    mergedFields.duration = durFrom.duration;

    const distFrom = pick("distance") === "a" ? srcA : srcB;
    mergedFields.distance = distFrom.distance;

    const calFrom = pick("calories") === "a" ? srcA : srcB;
    mergedFields.calories = calFrom.calories;

    const hrFrom = pick("hr") === "a" ? srcA : srcB;
    if (hrFrom.avgHr) mergedFields.averageHR = hrFrom.avgHr;
    if (hrFrom.maxHr) mergedFields.maxHR = hrFrom.maxHr;

    try {
      const res = await fetch("/api/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          survivorId: survivor.id,
          deleteId: toDelete.id,
          mergedFields,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResolved((r) => r + 1);
        goNext();
      }
    } catch {
      // silently fail
    }
    setResolving(false);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scanning for duplicates...
        </CardContent>
      </Card>
    );
  }

  if (pairs.length === 0 || currentIndex >= pairs.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Check className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {resolved > 0
              ? `${resolved} duplicate${resolved > 1 ? "s" : ""} resolved. No more duplicates found.`
              : "No duplicate activities detected."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            <CardTitle className="text-base">Duplicate Activities</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {currentIndex + 1} of {pairs.length}
            {resolved > 0 && ` · ${resolved} resolved`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Column headers */}
        <div className="grid grid-cols-[120px_1fr_1fr] gap-2 pb-1 border-b border-border">
          <span />
          <button
            onClick={() => setSheetActivityId(pair.a.id)}
            className="text-xs font-medium text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors text-left"
          >
            <Eye className="h-3 w-3" />
            Activity A
            {pair.a.detailEndpoints > pair.b.detailEndpoints && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">more data</Badge>
            )}
          </button>
          <button
            onClick={() => setSheetActivityId(pair.b.id)}
            className="text-xs font-medium text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors text-left"
          >
            <Eye className="h-3 w-3" />
            Activity B
            {pair.b.detailEndpoints > pair.a.detailEndpoints && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">more data</Badge>
            )}
          </button>
        </div>

        {/* Field rows */}
        <FieldRow label="Name" valueA={pair.a.name} valueB={pair.b.name}
          selected={selections.name} onSelect={(s) => handleSelect("name", s)} />
        <FieldRow label="Type" valueA={pair.a.type?.replace(/_/g, " ")} valueB={pair.b.type?.replace(/_/g, " ")}
          selected={selections.type} onSelect={(s) => handleSelect("type", s)} />
        <FieldRow label="Start Time" valueA={formatTime(pair.a.startTime)} valueB={formatTime(pair.b.startTime)}
          selected={selections.startTime} onSelect={(s) => handleSelect("startTime", s)} />
        <FieldRow label="Duration" valueA={formatDuration(pair.a.duration)} valueB={formatDuration(pair.b.duration)}
          selected={selections.duration} onSelect={(s) => handleSelect("duration", s)} />
        <FieldRow label="Distance" valueA={formatDistance(pair.a.distance)} valueB={formatDistance(pair.b.distance)}
          selected={selections.distance} onSelect={(s) => handleSelect("distance", s)} />
        <FieldRow label="Calories" valueA={pair.a.calories ? `${pair.a.calories} kcal` : ""} valueB={pair.b.calories ? `${pair.b.calories} kcal` : ""}
          selected={selections.calories} onSelect={(s) => handleSelect("calories", s)} />
        <FieldRow label="Heart Rate"
          valueA={pair.a.avgHr ? `${Math.round(pair.a.avgHr)} avg / ${Math.round(pair.a.maxHr || 0)} max` : ""}
          valueB={pair.b.avgHr ? `${Math.round(pair.b.avgHr)} avg / ${Math.round(pair.b.maxHr || 0)} max` : ""}
          selected={selections.hr} onSelect={(s) => handleSelect("hr", s)} />

        {/* Actions */}
        <div className="flex gap-2 pt-3">
          <Button
            onClick={handleResolve}
            disabled={resolving}
            className="flex-1"
            variant="default"
          >
            {resolving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Merging...</>
            ) : (
              <><Trash2 className="h-4 w-4 mr-2" />Merge & Delete Other</>
            )}
          </Button>
          <Button onClick={handleSkip} variant="outline" disabled={resolving}>
            Skip <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <ActivityDetailSheet
          activityId={sheetActivityId}
          open={sheetActivityId !== null}
          onOpenChange={(open) => { if (!open) setSheetActivityId(null); }}
        />
      </CardContent>
    </Card>
  );
}
