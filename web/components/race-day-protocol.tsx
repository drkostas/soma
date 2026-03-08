"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy } from "lucide-react";

interface ProtocolItem {
  time: string;
  action: string;
  section: "prep" | "morning" | "race";
}

const PROTOCOL: ProtocolItem[] = [
  // Day Before
  { time: "D-1", action: "Carb load: 8-10 g/kg (~640-800g CHO). Pasta, rice, bread, sports drink. Avoid fiber/fat.", section: "prep" },
  { time: "D-1 PM", action: "Lay out race kit. Pin bib. Charge watch. Set 2 alarms.", section: "prep" },
  // Race Morning
  { time: "T-3.5h", action: "Wake (4:30 AM for 8:00 start).", section: "morning" },
  { time: "T-3h", action: "Breakfast: 120-160g CHO — toast + jam + banana + sports drink. No new foods.", section: "morning" },
  { time: "T-1.5h", action: "Coffee (240mg caffeine / 3 mg/kg). Bathroom stop.", section: "morning" },
  { time: "T-1h", action: "Arrive venue. Light jog 5 min. Dynamic stretches.", section: "morning" },
  { time: "T-30m", action: "Stop drinking. Find start corral.", section: "morning" },
  { time: "T-15m", action: "Strides: 3x15s. Shake out legs.", section: "morning" },
  // Race
  { time: "Start", action: "B-pace (4:44/km). Stay controlled. DO NOT chase A-goal.", section: "race" },
  { time: "5K", action: "Check: breathing controlled? Effort sustainable? Hold B-pace.", section: "race" },
  { time: "~40m", action: "GEL #1 (caffeinated, ~25g CHO + 50mg caffeine) with water.", section: "race" },
  { time: "10K", action: "If strong + breathing easy → shift to A-pace (4:30/km). If tired → hold B.", section: "race" },
  { time: "~75m", action: "GEL #2 (regular, ~25g CHO) with water. Skip if <10 min to finish.", section: "race" },
  { time: "15K", action: "Commit to current pace. No acceleration if not already at A.", section: "race" },
  { time: "20K", action: "Last push. If feeling good, slight negative split.", section: "race" },
  { time: "Finish", action: "Empty the tank last 1.1 km.", section: "race" },
];

const SECTION_LABELS: Record<string, string> = {
  prep: "Day Before",
  morning: "Race Morning",
  race: "Race",
};

export function RaceDayProtocol() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Trophy className="h-4 w-4" style={{ color: "oklch(65% 0.2 55)" }} />
          Race Day Protocol
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {PROTOCOL.map((item, i) => {
            const prevSection = i > 0 ? PROTOCOL[i - 1].section : null;
            const showDivider = item.section !== prevSection;
            return (
              <div key={i}>
                {showDivider && (
                  <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider pt-1.5 pb-0.5">
                    {SECTION_LABELS[item.section]}
                  </div>
                )}
                <div className="flex gap-2 text-xs">
                  <span className="text-muted-foreground font-mono w-14 shrink-0 text-right">
                    {item.time}
                  </span>
                  <span>{item.action}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
