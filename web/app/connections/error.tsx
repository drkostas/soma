"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ConnectionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Connections page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <h2 className="text-lg font-semibold">Failed to load connections</h2>
      <p className="text-sm text-muted-foreground max-w-md text-center">
        {error.message || "An unexpected error occurred while loading the page."}
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
