/**
 * Every file that exists twice must be the same file twice.
 *
 * `capture-status.ts` and `dictation.ts` are each copied between `web/` and `universal/`, because
 * the two packages cannot import from one another, and a second copy of anything the owner reads
 * or hears is a promise to keep them identical.
 *
 * ⛔ THIS COMPARES THE FILES AS TEXT RATHER THAN IMPORTING BOTH MODULES, and that is not
 * squeamishness. Importing `../../../web/lib/...` works at runtime, because neither file has a
 * runtime import, but it drags the web file into this package's tsc program, and from there
 * `web/lib/meal-capture.ts` pulls in `web/lib/db.ts`, which needs `pg` and
 * `@neondatabase/serverless`. Those are not installed here, so `npm run typecheck` passed on my
 * machine, where the sibling node_modules happened to resolve, and failed in CI, which installs
 * this package alone. Text is also the stronger check: identical bodies cannot behave differently.
 *
 * Only the leading block comment may differ, because each copy says where it sits.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** Each pair, with the marker that separates the header from the body that has to match. */
const PAIRS = [
  { name: "capture-status.ts", app: "capture-status.ts", web: "capture-status.ts", from: "import type" },
  { name: "dictation.ts", app: "dictation.ts", web: "dictation.ts", from: "/** What was in the box" },
];

function body(path: string, from: string): string {
  const s = readFileSync(path, "utf8");
  const i = s.indexOf(from);
  if (i < 0) throw new Error(`${path} has no "${from}" to anchor on, so the copies cannot be compared`);
  return s.slice(i);
}

describe.each(PAIRS)("$name exists twice and is the same file twice", (pair) => {
  const app = resolve(here, pair.app);
  const web = resolve(here, "../../../web/lib", pair.web);

  it("has both copies on disk, because one missing is the failure this guards", () => {
    expect(existsSync(app)).toBe(true);
    expect(existsSync(web)).toBe(true);
  });

  it("is identical from the anchor onwards", () => {
    // A failure here means one copy was changed alone. Copy the other file's body across, keeping
    // this file's header, which is what both headers tell you to do.
    expect(body(app, pair.from)).toBe(body(web, pair.from));
  });

  it("keeps a header on each, and the app's says it is a copy", () => {
    for (const p of [app, web]) expect(readFileSync(p, "utf8").startsWith("/**")).toBe(true);
    // Only this side has to declare the arrangement. The web file is the original, and a reader
    // who lands there should not be told it is a copy of something else.
    expect(readFileSync(app, "utf8")).toContain("SECOND COPY");
  });
});
