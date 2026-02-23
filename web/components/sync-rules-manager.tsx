"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Route, Plus, Trash2, ToggleLeft, ToggleRight, ArrowRight } from "lucide-react";

interface SyncRule {
  id: number;
  source_platform: string;
  activity_type: string;
  preprocessing: string[];
  destinations: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  created_at?: string;
}

interface SyncRulesManagerProps {
  initialRules: SyncRule[];
}

const SOURCE_OPTIONS = [
  { value: "hevy", label: "Hevy" },
  { value: "garmin", label: "Garmin" },
  { value: "surfr", label: "Surfr" },
];

const ACTIVITY_TYPE_OPTIONS = [
  { value: "*", label: "All" },
  { value: "strength", label: "Strength" },
  { value: "running", label: "Running" },
  { value: "cycling", label: "Cycling" },
  { value: "kite", label: "Kite" },
];

const DESTINATION_OPTIONS = [
  { value: "strava", label: "Strava" },
  { value: "garmin", label: "Garmin" },
];

export function SyncRulesManager({ initialRules }: SyncRulesManagerProps) {
  const router = useRouter();
  const [rules, setRules] = useState<SyncRule[]>(initialRules);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState<number | null>(null);

  // Form state
  const [newSource, setNewSource] = useState("hevy");
  const [newActivityType, setNewActivityType] = useState("*");
  const [newDestination, setNewDestination] = useState("strava");

  async function handleToggle(rule: SyncRule) {
    setLoading(rule.id);
    try {
      const res = await fetch(`/api/connections/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setRules((prev) =>
          prev.map((r) => (r.id === rule.id ? { ...r, ...data.rule } : r))
        );
      }
    } catch (err) {
      console.error("Error toggling rule:", err);
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete(id: number) {
    setLoading(id);
    try {
      const res = await fetch(`/api/connections/rules/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id));
      }
    } catch (err) {
      console.error("Error deleting rule:", err);
    } finally {
      setLoading(null);
    }
  }

  async function handleCreate() {
    setLoading(-1);
    try {
      const res = await fetch("/api/connections/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_platform: newSource,
          activity_type: newActivityType,
          destinations: { [newDestination]: { enabled: true } },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRules((prev) => [...prev, data.rule]);
        setShowForm(false);
        setNewSource("hevy");
        setNewActivityType("*");
        setNewDestination("strava");
        router.refresh();
      }
    } catch (err) {
      console.error("Error creating rule:", err);
    } finally {
      setLoading(null);
    }
  }

  function getDestinationNames(destinations: Record<string, unknown>): string[] {
    return Object.keys(destinations);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Route className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Sync Rules</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="h-4 w-4" />
            Add Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Add Rule Form */}
        {showForm && (
          <div className="rounded-lg border border-border bg-accent/30 p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Source
                </label>
                <select
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Activity Type
                </label>
                <select
                  value={newActivityType}
                  onChange={(e) => setNewActivityType(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {ACTIVITY_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Destination
                </label>
                <select
                  value={newDestination}
                  onChange={(e) => setNewDestination(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {DESTINATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={loading === -1}
              >
                {loading === -1 ? "Creating..." : "Create Rule"}
              </Button>
            </div>
          </div>
        )}

        {/* Rules List */}
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No sync rules configured yet.
          </p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleToggle(rule)}
                    disabled={loading === rule.id}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={rule.enabled ? "Disable rule" : "Enable rule"}
                  >
                    {rule.enabled ? (
                      <ToggleRight className="h-5 w-5 text-green-500" />
                    ) : (
                      <ToggleLeft className="h-5 w-5" />
                    )}
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize text-xs">
                      {rule.source_platform}
                    </Badge>
                    {rule.activity_type !== "*" && (
                      <Badge variant="outline" className="text-xs">
                        {rule.activity_type}
                      </Badge>
                    )}
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    {getDestinationNames(rule.destinations).map((dest) => (
                      <Badge key={dest} variant="secondary" className="capitalize text-xs">
                        {dest}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleDelete(rule.id)}
                  disabled={loading === rule.id}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
