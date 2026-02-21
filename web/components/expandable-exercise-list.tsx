"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function ExpandableExerciseList({ exercises }: { exercises: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const showAll = expanded || exercises.length <= 5;
  const visible = showAll ? exercises : exercises.slice(0, 5);

  return (
    <div className="space-y-1">
      {visible.map((name, i) => (
        <div key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
          {name}
        </div>
      ))}
      {exercises.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 mt-1 transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              +{exercises.length - 5} more
            </>
          )}
        </button>
      )}
    </div>
  );
}
