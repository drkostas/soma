import { View } from "react-native";
import { Text, Card } from "soma-style";

/* Ported verbatim from web/components/race-day-protocol.tsx so the app shows the
   same race-day plan. Static content. */
interface Step { time: string; action: string; section: "prep" | "morning" | "race" }
const PROTOCOL: Step[] = [
  { time: "D-1", action: "Carb load: 8-10 g/kg (~640-800g CHO). Pasta, rice, bread, sports drink. Avoid fiber/fat.", section: "prep" },
  { time: "D-1 PM", action: "Lay out race kit. Pin bib. Charge watch. Set 2 alarms.", section: "prep" },
  { time: "T-3.5h", action: "Wake (4:30 AM for 8:00 start).", section: "morning" },
  { time: "T-3h", action: "Breakfast: 120-160g CHO — toast + jam + banana + sports drink. No new foods.", section: "morning" },
  { time: "T-1.5h", action: "Coffee (240mg caffeine / 3 mg/kg). Bathroom stop.", section: "morning" },
  { time: "T-1h", action: "Arrive venue. Light jog 5 min. Dynamic stretches.", section: "morning" },
  { time: "T-30m", action: "Stop drinking. Find start corral.", section: "morning" },
  { time: "T-15m", action: "Strides: 3x15s. Shake out legs.", section: "morning" },
  { time: "Start", action: "B-pace (4:44/km). Stay controlled. DO NOT chase A-goal.", section: "race" },
  { time: "5K", action: "Check: breathing controlled? Effort sustainable? Hold B-pace.", section: "race" },
  { time: "~40m", action: "GEL #1 (caffeinated, ~25g CHO + 50mg caffeine) with water.", section: "race" },
  { time: "10K", action: "If strong + breathing easy → shift to A-pace (4:30/km). If tired → hold B.", section: "race" },
  { time: "~75m", action: "GEL #2 (regular, ~25g CHO) with water. Skip if <10 min to finish.", section: "race" },
  { time: "15K", action: "Commit to current pace. No acceleration if not already at A.", section: "race" },
  { time: "20K", action: "Last push. If feeling good, slight negative split.", section: "race" },
  { time: "Finish", action: "Empty the tank last 1.1 km.", section: "race" },
];
const SECTION_LABEL: Record<Step["section"], string> = {
  prep: "Day before",
  morning: "Race morning",
  race: "Race",
};
const SECTIONS: Step["section"][] = ["prep", "morning", "race"];

export function RaceProtocol() {
  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <Text variant="eyebrow">🏆 Race day protocol</Text>
      </View>
      {SECTIONS.map((sec) => (
        <View key={sec} className="gap-1.5">
          <Text variant="micro" className="text-text-muted uppercase">{SECTION_LABEL[sec]}</Text>
          {PROTOCOL.filter((s) => s.section === sec).map((s, i) => (
            <View key={i} className="flex-row gap-2">
              <Text variant="micro" className="tabular-nums text-teal w-14 text-right">{s.time}</Text>
              <Text variant="micro" className="text-text-secondary flex-1">{s.action}</Text>
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}
