"use client";

import { useState } from "react";
import { StatDetailDialog } from "./stat-detail-dialog";

export function ClickableRecoveryCard({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div onClick={() => setOpen(true)} className="cursor-pointer transition-colors hover:bg-muted/50 rounded-xl">
        {children}
      </div>
      <StatDetailDialog metric="recovery" open={open} onOpenChange={setOpen} />
    </>
  );
}
