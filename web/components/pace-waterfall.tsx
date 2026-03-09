"use client"

interface WaterfallItem {
  label: string
  seconds: number  // positive = slower, negative = faster
  color: string
}

export function PaceWaterfall({ basePace, items, adjustedPace }: {
  basePace: number
  items: WaterfallItem[]
  adjustedPace: number
}) {
  const maxAbs = Math.max(...items.map(i => Math.abs(i.seconds)), 1)

  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between font-mono">
        <span>Base pace</span>
        <span>{formatPaceSeconds(basePace)}</span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-20 truncate text-muted-foreground">{item.label}</span>
          <div className="flex-1 h-3 relative bg-zinc-800 rounded overflow-hidden">
            <div
              className="absolute top-0 h-full rounded"
              style={{
                background: item.color,
                width: `${Math.abs(item.seconds) / maxAbs * 50}%`,
                left: item.seconds < 0 ? `${50 - Math.abs(item.seconds) / maxAbs * 50}%` : "50%",
              }}
            />
            {/* Center line */}
            <div className="absolute top-0 left-1/2 w-px h-full bg-zinc-600" />
          </div>
          <span className="w-12 text-right font-mono" style={{ color: item.color }}>
            {item.seconds >= 0 ? "+" : ""}{item.seconds.toFixed(1)}s
          </span>
        </div>
      ))}
      <div className="flex justify-between font-mono font-bold border-t border-border/30 pt-1">
        <span>Adjusted pace</span>
        <span>{formatPaceSeconds(adjustedPace)}</span>
      </div>
    </div>
  )
}

function formatPaceSeconds(s: number): string {
  const min = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${min}:${sec.toString().padStart(2, "0")}/km`
}
