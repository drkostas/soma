/**
 * Segment-based playlist scoring + selection. Re-exported from the standalone
 * `run-dj` npm package (drkostas/run-dj) — pure algorithm, no I/O. Thin shim so
 * existing `@/lib/playlist-algorithm` imports keep working unchanged.
 */
export * from "run-dj/playlist-algorithm";
