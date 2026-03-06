import { RefreshCw } from "lucide-react";

export default function ConnectionsLoading() {
  return (
    <div className="flex items-center justify-center gap-3 py-20">
      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Loading connections...</span>
    </div>
  );
}
