"use client";

import { useState } from "react";
import { Upload, Check, AlertCircle, Loader2, Clock } from "lucide-react";

export function GarminPushButton({
  dayId, status, hasSteps,
}: { dayId: number; status: string; hasSteps: boolean }) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [loading, setLoading] = useState(false);

  if (!hasSteps) return null;

  async function handlePush() {
    setLoading(true);
    try {
      const res = await fetch(`/api/training/day/${dayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ garmin_push_status: "pending" }),
      });
      if (res.ok) {
        setCurrentStatus("pending");
        await fetch("/api/training/engine", { method: "POST" });
      }
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;

  switch (currentStatus) {
    case "pushed":
    case "success":
      return <Check className="h-3.5 w-3.5" style={{ color: "oklch(62% 0.17 142)" }} />;
    case "failed":
    case "error":
      return (
        <button onClick={handlePush} className="hover:opacity-80 transition-opacity" title="Retry push to Garmin">
          <AlertCircle className="h-3.5 w-3.5" style={{ color: "oklch(60% 0.22 25)" }} />
        </button>
      );
    case "pending":
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return (
        <button onClick={handlePush} className="hover:opacity-80 transition-opacity" title="Push to Garmin">
          <Upload className="h-3.5 w-3.5 text-muted-foreground/40" />
        </button>
      );
  }
}
