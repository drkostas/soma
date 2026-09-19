import { describe, it, expect } from "vitest";
import { resolveClaudeCmd, CANDIDATE_PATHS } from "./claude-cmd";

describe("resolveClaudeCmd", () => {
  it("prefers CLAUDE_CMD when it is set", () => {
    expect(resolveClaudeCmd({ CLAUDE_CMD: "/custom/claude" }, () => false)).toBe("/custom/claude");
  });

  it("falls back to the first candidate that exists on disk", () => {
    const exists = (p: string) => p === CANDIDATE_PATHS[1];
    expect(resolveClaudeCmd({ HOME: "/Users/x" }, exists)).toBe(CANDIDATE_PATHS[1]);
  });

  it("expands ~ in a candidate against HOME", () => {
    const home = "/Users/x";
    const expanded = `${home}/.local/bin/claude`;
    expect(resolveClaudeCmd({ HOME: home }, (p) => p === expanded)).toBe(expanded);
  });

  it("gives up on the bare name, so PATH still gets a chance", () => {
    expect(resolveClaudeCmd({ HOME: "/Users/x" }, () => false)).toBe("claude");
  });

  it("looks in the place a launchd job without a PATH would miss", () => {
    // The sync job's plist carries no PATH and no CLAUDE_CMD, so `claude` alone is ENOENT there.
    expect(CANDIDATE_PATHS.some((p) => p.includes(".local/bin/claude"))).toBe(true);
  });
});
