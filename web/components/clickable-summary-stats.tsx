"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface StatCard {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  timelineData: { date: string; value: number; label?: string }[];
  timelineLabel: string;
  timelineUnit: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ClickableSummaryStats({ stats }: { stats: StatCard[] }) {
  const [selected, setSelected] = useState<StatCard | null>(null);

  const avg = selected
    ? Math.round(selected.timelineData.reduce((s, d) => s + d.value, 0) / (selected.timelineData.length || 1))
    : 0;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="cursor-pointer hover:bg-accent/5 transition-colors"
            onClick={() => stat.timelineData.length > 0 && setSelected(stat)}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              {stat.icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle>{selected.label} Over Time</SheetTitle>
                <div className="text-sm text-muted-foreground">
                  {selected.timelineData.length} data points · Avg: {avg} {selected.timelineUnit}
                </div>
              </SheetHeader>

              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={selected.timelineData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      className="text-[10px]"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      className="text-[10px]"
                      tickLine={false}
                      axisLine={false}
                      width={45}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-popover border border-border rounded-lg p-2 text-xs shadow-md">
                            <div className="font-medium">{formatDate(d.date)}</div>
                            {d.label && <div className="text-muted-foreground">{d.label}</div>}
                            <div className="mt-1">
                              {Math.round(d.value)} {selected.timelineUnit}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine
                      y={avg}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="6 4"
                      strokeOpacity={0.4}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={{ r: 2, fill: "var(--primary)" }}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Recent values list */}
              <div className="mt-6 space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Recent
                </h4>
                {selected.timelineData.slice(-20).reverse().map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/20">
                    <span className="text-muted-foreground">{formatDate(d.date)}</span>
                    <div className="flex items-center gap-2">
                      {d.label && <span className="text-muted-foreground">{d.label}</span>}
                      <span className="font-medium">{Math.round(d.value)} {selected.timelineUnit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
