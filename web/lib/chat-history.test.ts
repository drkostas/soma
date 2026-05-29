import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We mock node:os.homedir to point at a per-test temp dir; the module under
// test reads homedir() lazily inside sessionJsonlPath, so mocking before
// import is enough.
let tmpHome = "";
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => tmpHome,
  };
});

// Import after the mock is registered.
const { hydrateFromJsonl, sessionJsonlPath } = await import("./chat-history");

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "soma-test-"));
});
afterEach(() => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

function writeSession(sessionId: string, cwd: string, lines: object[]) {
  const dir = join(tmpHome, ".claude", "projects", cwd.replace(/\//g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n")
  );
}

describe("hydrateFromJsonl", () => {
  it("returns empty when no jsonl exists", async () => {
    const out = await hydrateFromJsonl("does-not-exist", "/repo/x");
    expect(out).toEqual([]);
  });

  it("parses a simple user/assistant turn with text", async () => {
    writeSession("s1", "/repo/x", [
      { type: "user", content: "hello" },
      { type: "assistant" },
      { type: "text", text: "hi back" },
    ]);
    const out = await hydrateFromJsonl("s1", "/repo/x");
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe("user");
    expect(out[0].userPrompt).toBe("hello");
    expect(out[1].role).toBe("assistant");
    expect(out[1].steps).toHaveLength(1);
    expect(out[1].steps[0].kind).toBe("text");
    if (out[1].steps[0].kind === "text") {
      expect(out[1].steps[0].text).toBe("hi back");
    }
  });

  it("captures tool_use with name + input", async () => {
    writeSession("s2", "/repo/x", [
      { type: "user", content: "run ls" },
      { type: "assistant" },
      { type: "tool_use", uuid: "tu_1", name: "Bash", input: { command: "ls" } },
    ]);
    const out = await hydrateFromJsonl("s2", "/repo/x");
    expect(out).toHaveLength(2);
    expect(out[1].steps).toHaveLength(1);
    const tool = out[1].steps[0];
    expect(tool.kind).toBe("tool");
    if (tool.kind === "tool") {
      expect(tool.name).toBe("Bash");
      expect(tool.input).toEqual({ command: "ls" });
      expect(tool.status).toBe("done");
    }
  });

  it("attaches tool_result output to the matching tool_use by id", async () => {
    writeSession("s3", "/repo/x", [
      { type: "user", content: "run ls" },
      { type: "assistant" },
      { type: "tool_use", uuid: "tu_2", name: "Bash", input: { command: "ls /tmp" } },
      {
        type: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_2",
            content: "foo.txt\nbar.txt",
            is_error: false,
          },
        ],
      },
      { type: "text", text: "done" }, // belongs to the same assistant turn (no new role marker)
    ]);
    const out = await hydrateFromJsonl("s3", "/repo/x");
    expect(out.length).toBeGreaterThanOrEqual(2);
    // Find the tool step
    const all = out.flatMap((m) => m.steps);
    const tool = all.find((s) => s.kind === "tool");
    expect(tool).toBeDefined();
    if (tool && tool.kind === "tool") {
      expect(tool.output).toContain("foo.txt");
      expect(tool.outputFull).toContain("bar.txt");
      expect(tool.isError).toBe(false);
    }
  });

  it("truncates large tool output but preserves outputFull", async () => {
    const big = "x".repeat(2000);
    writeSession("s4", "/repo/x", [
      { type: "user", content: "do" },
      { type: "assistant" },
      { type: "tool_use", uuid: "tu_3", name: "Bash", input: { command: "yes" } },
      {
        type: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_3", content: big }],
      },
    ]);
    const out = await hydrateFromJsonl("s4", "/repo/x");
    const tool = out.flatMap((m) => m.steps).find((s) => s.kind === "tool");
    if (!tool || tool.kind !== "tool") throw new Error("no tool step");
    expect(tool.outputTruncated).toBe(true);
    expect(tool.output.length).toBeLessThanOrEqual(800);
    expect(tool.outputFull.length).toBe(2000);
  });

  it("captures thinking blocks", async () => {
    writeSession("s5", "/repo/x", [
      { type: "user", content: "hard q" },
      { type: "assistant" },
      { type: "thinking", thinking: "let me ponder" },
      { type: "text", text: "answer" },
    ]);
    const out = await hydrateFromJsonl("s5", "/repo/x");
    const assistant = out.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    const kinds = assistant!.steps.map((s) => s.kind);
    expect(kinds).toEqual(["thinking", "text"]);
  });

  it("returns at most `limit` messages, keeping the last ones", async () => {
    const lines: object[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push({ type: "user", content: `q${i}` });
      lines.push({ type: "assistant" });
      lines.push({ type: "text", text: `a${i}` });
    }
    writeSession("s6", "/repo/x", lines);
    const out = await hydrateFromJsonl("s6", "/repo/x", 6);
    expect(out).toHaveLength(6);
    // Last 3 user/assistant pairs → q17/a17 … q19/a19
    expect(out[0].userPrompt).toBe("q17");
    expect(out[5].steps[0].kind).toBe("text");
  });
});

describe("sessionJsonlPath", () => {
  it("encodes /-paths into -dashes", () => {
    const p = sessionJsonlPath("abc", "/Users/x/y");
    expect(p).toMatch(/projects\/-Users-x-y\/abc\.jsonl$/);
  });
  it("returns the .jsonl extension", () => {
    expect(existsSync(sessionJsonlPath("noexist", "/no"))).toBe(false);
  });
});
