"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  info?: string;
  trend?: { value: number; label?: string } | null;
  onClick?: () => void;
}

export function StatCard({ title, value, subtitle, icon, info, trend, onClick }: StatCardProps) {
  return (
    <Card
      className={cn(
        "hover:bg-muted/50 hover:shadow-sm transition-all duration-200",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
          {title}
          {info && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 shrink-0 cursor-help"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Info className="h-3 w-3 text-muted-foreground opacity-50 hover:opacity-100 transition-opacity" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                  {info}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1.5">
          <div className="text-xl sm:text-2xl font-bold truncate">{value}</div>
          {trend != null && (() => {
            const abs = Math.abs(trend.value);
            const isUp = trend.value > 0;
            const isNeutral = abs < 1;
            const arrow = isNeutral ? "\u2192" : isUp ? "\u2191" : "\u2193";
            const pct = isNeutral ? "~0%" : `${isUp ? "+" : "\u2212"}${abs.toFixed(0)}%`;
            const color = isNeutral
              ? "var(--muted-foreground)"
              : isUp
                ? "oklch(62% 0.17 142)"
                : "oklch(60% 0.22 25)";
            return (
              <span
                className="text-[10px] font-medium leading-none whitespace-nowrap"
                style={{ color }}
                title={trend.label ?? `${pct} vs prior period`}
              >
                {arrow} {pct}
              </span>
            );
          })()}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
