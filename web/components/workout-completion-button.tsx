"use client";

import { useState } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function WorkoutCompletionButton({
  dayId,
  completed: initialCompleted,
}: {
  dayId: number;
  completed: boolean;
}) {
  const [completed, setCompleted] = useState(initialCompleted);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function toggle() {
    setLoading(true);
    const newState = !completed;
    try {
      const res = await fetch(`/api/training/day/${dayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: newState }),
      });
      if (res.ok) {
        setCompleted(newState);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className="shrink-0 p-0.5 rounded-full transition-colors hover:bg-muted"
      title={completed ? "Mark incomplete" : "Mark complete"}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : completed ? (
        <Check className="h-4 w-4" style={{ color: "oklch(62% 0.17 142)" }} />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground/40" />
      )}
    </button>
  );
}
