/**
 * HR → music BPM formula. Now re-exported from the standalone `run-dj` npm
 * package (drkostas/run-dj), which holds the pure, I/O-free DJ core shared
 * across the Soma ecosystem. Kept as a thin shim so existing `@/lib/bpm-formula`
 * imports keep working. The DB/Garmin/Spotify glue stays in lib/dj-daemon.ts.
 */
export * from "run-dj/bpm-formula";
