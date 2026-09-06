import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * soma-style defines a colour token named `base` (the dark page background), so
 * Tailwind resolves the utility `text-base` as `color: var(--color-base)` rather
 * than the 1rem font size. Every card title on the Sync Hub rendered dark text on
 * a dark card because of it (#737). Use `text-[1rem]` for the size instead.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("no text-base utility (#737)", () => {
  it("app/ and components/ never use the ambiguous text-base class", () => {
    const root = join(__dirname, "..");
    const offenders: string[] = [];
    for (const f of [...walk(join(root, "app")), ...walk(join(root, "components"))]) {
      const src = readFileSync(f, "utf8");
      if (/\btext-base\b/.test(src)) offenders.push(f.replace(root + "/", ""));
    }
    expect(offenders, "replace text-base with text-[1rem]; a `base` colour token makes it a colour").toEqual([]);
  });
});
