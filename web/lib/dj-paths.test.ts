import { describe, it, expect } from "vitest";
import { djStateDir, djPaths } from "./dj-paths";

describe("dj-paths (#668)", () => {
  it("SOMA_STATE_DIR wins everywhere", () => {
    expect(djStateDir({ SOMA_STATE_DIR: "/srv/soma-state" }, "linux", "/home/k")).toBe("/srv/soma-state/dj");
    expect(djStateDir({ SOMA_STATE_DIR: "/srv/soma-state" }, "darwin", "/Users/k")).toBe("/srv/soma-state/dj");
  });
  it("macOS uses Application Support, others ~/.soma; never /tmp", () => {
    expect(djStateDir({}, "darwin", "/Users/k")).toBe("/Users/k/Library/Application Support/soma/dj");
    expect(djStateDir({}, "linux", "/home/k")).toBe("/home/k/.soma/dj");
    expect(djStateDir({}, "darwin", "/Users/k")).not.toMatch(/^\/tmp/);
  });
  it("the four files hang off the directory", () => {
    const p = djPaths("/x/dj");
    expect(p).toEqual({ dir: "/x/dj", statusFile: "/x/dj/status.json", pidFile: "/x/dj/pid", logFile: "/x/dj/daemon.log", playedFile: "/x/dj/played.json" });
  });
});
