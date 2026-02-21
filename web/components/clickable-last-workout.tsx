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
        className="cursor-pointer transition-colors hover:bg-muted/50 rounded-xl"
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
