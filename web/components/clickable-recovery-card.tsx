"use client";

import { useState } from "react";
import { StatDetailDialog } from "./stat-detail-dialog";

export function ClickableRecoveryCard({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
        tabIndex={0}
        role="button"
        className="cursor-pointer transition-colors hover:bg-muted/50 active:scale-[0.99] rounded-xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {children}
      </div>
      <StatDetailDialog metric="recovery" open={open} onOpenChange={setOpen} />
    </>
  );
}
