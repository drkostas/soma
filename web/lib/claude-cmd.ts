/**
 * Where `claude` is, for the code that spawns it.
 *
 * ⛔ THE BARE NAME IS NOT ENOUGH. A launchd job inherits almost nothing: soma's sync plist carries
 * `LC_ALL`, `LANG` and `HOME` and no `PATH` at all, so `spawn("claude")` there fails with ENOENT
 * and every capture the sweep picks up would fail with it. Found 2026-09-19 by running the
 * verification rather than reading it.
 *
 * `CLAUDE_CMD` still wins, because the web service sets it explicitly. This only decides what to
 * do when nobody said.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";

/** Where the installer puts it, in the order worth trying. `~` is expanded against HOME. */
export const CANDIDATE_PATHS = [
  "~/.local/bin/claude",
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
] as const;

export function resolveClaudeCmd(
  env: Record<string, string | undefined> = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  if (env.CLAUDE_CMD) return env.CLAUDE_CMD;
  const home = env.HOME || homedir();
  for (const c of CANDIDATE_PATHS) {
    const p = c.startsWith("~/") ? `${home}/${c.slice(2)}` : c;
    if (exists(p)) return p;
  }
  // Nothing found: hand back the bare name so a normal PATH still works.
  return "claude";
}
