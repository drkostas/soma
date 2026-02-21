"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RANGES } from "@/lib/time-ranges";

function TimeRangeSelectorInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("range") || "6m";

  return (
    <div className="flex flex-wrap gap-1">
      {RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("range", r.value);
            router.push(`?${params.toString()}`);
          }}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
            current === r.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function TimeRangeSelector() {
  return (
    <Suspense fallback={<div className="h-6" />}>
      <TimeRangeSelectorInner />
    </Suspense>
  );
}
