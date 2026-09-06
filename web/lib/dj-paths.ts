import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Where the Live DJ daemon keeps its state (#668).
 *
 * It used to be /tmp (soma-dj-status.json, soma-dj-pid, soma-dj.log,
 * soma-dj-played.json). macOS purges /tmp, so a status read after a purge
 * reported "stopped" for a daemon that was still running and the played
 * history vanished between sessions. The state now lives in the user's
 * Application Support on macOS, ~/.soma on other hosts, or wherever
 * SOMA_STATE_DIR points. The directory is created on first use.
 */
export interface DjPaths {
  dir: string;
  statusFile: string;
  pidFile: string;
  logFile: string;
  playedFile: string;
}

export function djStateDir(env: Record<string, string | undefined> = process.env, os: string = platform(), home: string = homedir()): string {
  if (env.SOMA_STATE_DIR) return join(env.SOMA_STATE_DIR, "dj");
  if (os === "darwin") return join(home, "Library", "Application Support", "soma", "dj");
  return join(home, ".soma", "dj");
}

export function djPaths(dir: string = djStateDir()): DjPaths {
  return {
    dir,
    statusFile: join(dir, "status.json"),
    pidFile: join(dir, "pid"),
    logFile: join(dir, "daemon.log"),
    playedFile: join(dir, "played.json"),
  };
}

/** djPaths() with the directory created (idempotent). */
export function ensureDjPaths(dir: string = djStateDir()): DjPaths {
  mkdirSync(dir, { recursive: true });
  return djPaths(dir);
}
