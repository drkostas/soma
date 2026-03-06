"use client";

import { useState } from "react";
import { WorkoutDetailModal } from "./workout-detail-modal";

export function ClickableLastWorkout({
  workoutId,
  children,
}: {
  workoutId: string;
  children: React.ReactNode;
}) {
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
      <WorkoutDetailModal
        workoutId={open ? workoutId : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
