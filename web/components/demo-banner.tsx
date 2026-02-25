export function DemoBanner({ repoUrl }: { repoUrl: string }) {
  return (
    <div className="fixed left-16 right-0 top-0 z-50 flex items-center justify-center gap-3 bg-primary/10 px-4 py-1.5 text-xs text-primary backdrop-blur-sm border-b border-primary/20">
      <span className="font-medium">Demo</span>
      <span className="text-primary/60">·</span>
      <span className="text-primary/80">sample data — not real health records</span>
      <span className="text-primary/60">·</span>
      <a
        href={repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2 hover:text-primary/70 transition-colors"
      >
        Deploy your own ↗
      </a>
    </div>
  );
}
