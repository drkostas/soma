/**
 * Interleaved partition shuffle. Re-exported from the standalone `run-dj` npm
 * package (drkostas/run-dj) — pure algorithm, no I/O. Thin shim so existing
 * `./dj-shuffle` imports (dj-daemon, tests) keep working unchanged.
 */
export * from "run-dj/dj-shuffle";
