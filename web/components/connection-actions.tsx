"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Unplug, Link as LinkIcon } from "lucide-react";

interface ConnectionActionsProps {
  platform: string;
  isConnected: boolean;
}

export function ConnectionActions({ platform, isConnected }: ConnectionActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDisconnect() {
    setLoading(true);
    try {
      const res = await fetch(`/api/connections/${platform}`, { method: "DELETE" });
      if (!res.ok) {
        console.error("Failed to disconnect:", await res.text());
      }
      router.refresh();
    } catch (err) {
      console.error("Error disconnecting:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleConnect() {
    if (platform === "strava") {
      window.location.href = "/api/strava/auth";
    }
  }

  if (isConnected) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleDisconnect}
        disabled={loading}
      >
        <Unplug className="h-4 w-4" />
        {loading ? "Disconnecting..." : "Disconnect"}
      </Button>
    );
  }

  if (platform === "strava") {
    return (
      <Button variant="default" size="sm" onClick={handleConnect}>
        <LinkIcon className="h-4 w-4" />
        Connect
      </Button>
    );
  }

  return null;
}
