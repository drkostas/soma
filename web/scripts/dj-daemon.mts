/**
 * CLI entrypoint for the live DJ daemon (TS port of dj_daemon.py's main()).
 * Spawned by /api/playlist/dj/start via `npx tsx`. Parses the same flags the
 * Python daemon took, loads the local env, and runs the loop until SIGTERM.
 */
import { runDaemon } from "../lib/dj-daemon";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

await runDaemon({
  hrRest: parseInt(arg("hr-rest", "60"), 10),
  hrMax: parseInt(arg("hr-max", "190"), 10),
  offset: parseInt(arg("offset", "0"), 10),
  genres: list(arg("genres", "")),
  sources: list(arg("sources", "liked")),
  statusFile: arg("status-file", "/tmp/soma-dj-status.json"),
  pidFile: arg("pid-file", "/tmp/soma-dj-pid"),
});
