// web/components/dj-history-chart.tsx
"use client";
import {
  ComposedChart, Line, ReferenceLine, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface HrPoint { ts: number; hr: number; target_bpm: number | null; }
interface SongEvent { ts: number; name: string; artist: string; track_bpm: number; target_bpm: number; reason: string; }

interface Props {
  hrHistory: HrPoint[];
  songEvents: SongEvent[];
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function CustomTooltip({ active, payload, label, songEvents }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
  songEvents: SongEvent[];
}) {
  if (!active || !payload?.length || !label) return null;
  const song = [...songEvents].reverse().find(e => e.ts <= label);
  const hr = payload.find(p => p.name === "hr");
  const target = payload.find(p => p.name === "target_bpm");
  return (
    <div className="bg-popover border rounded shadow-lg px-3 py-2 text-xs space-y-1 max-w-[200px]">
      <div className="font-medium text-muted-foreground">{formatTime(label)}</div>
      {hr && <div>HR: <span className="font-medium text-foreground">{hr.value} bpm</span></div>}
      {target && target.value && <div>Target: <span className="font-medium">{target.value} BPM</span></div>}
      {song && (
        <div className="pt-1 border-t space-y-0.5">
          <div className="font-medium text-foreground truncate">{song.name}</div>
          <div className="text-muted-foreground">{song.artist}</div>
          <div>{song.track_bpm} BPM · <span className="text-muted-foreground/70">{song.reason}</span></div>
        </div>
      )}
    </div>
  );
}

export default function DjHistoryChart({ hrHistory, songEvents }: Props) {
  if (hrHistory.length < 2) {
    return (
      <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground/50">
        Chart appears after a few minutes of data…
      </div>
    );
  }

  const data = hrHistory.map(p => ({
    ts: p.ts,
    hr: p.hr,
    target_bpm: p.target_bpm ?? undefined,
  }));

  const allBpm = data.flatMap(d => [d.hr, d.target_bpm].filter(Boolean) as number[]);
  const yMin = Math.max(30, Math.min(...allBpm) - 10);
  const yMax = Math.min(220, Math.max(...allBpm) + 10);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={formatTime}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickCount={5}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip
          content={<CustomTooltip songEvents={songEvents} />}
          cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "4 2" }}
        />
        <Line
          dataKey="hr"
          name="hr"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
          connectNulls
        />
        <Line
          dataKey="target_bpm"
          name="target_bpm"
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          activeDot={false}
          connectNulls
        />
        {songEvents.map((evt, i) => (
          <ReferenceLine
            key={i}
            x={evt.ts}
            stroke="var(--primary)"
            strokeWidth={1}
            strokeOpacity={0.4}
            label={{
              value: `♪`,
              position: "top",
              fontSize: 10,
              fill: "var(--primary)",
              fillOpacity: 0.7,
            }}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
