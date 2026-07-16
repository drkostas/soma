import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome = "";
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => tmpHome };
});

const { readChatConfig, writeChatConfig } = await import("./chat-config");

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "soma-cfg-"));
});
afterEach(() => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

describe("chat-config", () => {
  it("returns empty sessionId when no file exists", async () => {
    const cfg = await readChatConfig();
    expect(cfg.sessionId).toBe("");
  });

  it("round-trips sessionId through write + read", async () => {
    await writeChatConfig({ sessionId: "abcdef" });
    const cfg = await readChatConfig();
    expect(cfg.sessionId).toBe("abcdef");
    const onDisk = readFileSync(join(tmpHome, ".soma", "chat.json"), "utf8");
    expect(JSON.parse(onDisk)).toEqual({ sessionId: "abcdef" });
  });

  it("tolerates malformed json", async () => {
    mkdirSync(join(tmpHome, ".soma"), { recursive: true });
    writeFileSync(join(tmpHome, ".soma", "chat.json"), "not json");
    const cfg = await readChatConfig();
    expect(cfg.sessionId).toBe("");
  });

  it("tolerates missing sessionId field", async () => {
    mkdirSync(join(tmpHome, ".soma"), { recursive: true });
    writeFileSync(join(tmpHome, ".soma", "chat.json"), JSON.stringify({ foo: "bar" }));
    const cfg = await readChatConfig();
    expect(cfg.sessionId).toBe("");
  });
});
