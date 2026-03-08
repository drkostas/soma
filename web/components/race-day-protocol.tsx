"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy } from "lucide-react";

const PROTOCOL = [
  { time: "T-3h", action: "Wake up. Light breakfast: oatmeal + banana + coffee." },
  { time: "T-1h", action: "Arrive at venue. Light jog 5 min. Dynamic stretches." },
  { time: "T-30m", action: "Caffeine gel (100mg). Sip water. Find start corral." },
  { time: "T-15m", action: "Strides: 3×15s. Shake out legs." },
  { time: "Start", action: "B-pace (4:44/km). Stay controlled." },
  { time: "5K", action: "Check: on pace? Evaluate effort. Stay at B." },
  { time: "10K", action: "Evaluate: if strong → begin A-pace (4:30/km). If tired → hold B." },
  { time: "~40m", action: "Gel #1 with water at aid station." },
  { time: "15K", action: "Commit to pace. No acceleration if not already at A." },
  { time: "~75m", action: "Gel #2 (if race >90 min). Water at every station." },
  { time: "20K", action: "Last push. If feeling good, slight negative split." },
  { time: "Finish", action: "Empty the tank last 1.1 km." },
];

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
          {PROTOCOL.map((item, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="text-muted-foreground font-mono w-12 shrink-0 text-right">
                {item.time}
              </span>
              <span>{item.action}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
