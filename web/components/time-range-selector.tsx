"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RANGES } from "@/lib/time-ranges";

const STORAGE_KEY = "soma_time_range";

function TimeRangeSelectorInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("range") || "6m";
  const [showFade, setShowFade] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // On mount: restore from localStorage if URL has no range param
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && !searchParams.get("range")) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("range", stored);
      router.replace(`?${params.toString()}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show/hide right fade gradient based on scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 10;
      setShowFade(!atEnd && el.scrollWidth > el.clientWidth);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div className="relative">
      <div ref={scrollRef} className="overflow-x-auto scrollbar-none -mx-1 px-1">
        <div className="flex gap-1 w-max">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => {
                localStorage.setItem(STORAGE_KEY, r.value);
                const params = new URLSearchParams(searchParams.toString());
                params.set("range", r.value);
                router.push(`?${params.toString()}`);
              }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap min-h-[44px] ${
                current === r.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {showFade && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none" />
      )}
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
