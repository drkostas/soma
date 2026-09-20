/**
 * The app's copy of the status vocabulary must be the website's, character for character.
 *
 * `capture-status.ts` exists twice because the app cannot import from the web package, and a
 * second copy of anything the owner reads is a promise to keep the two identical.
 *
 * ⛔ THIS COMPARES THE FILES AS TEXT RATHER THAN IMPORTING BOTH MODULES, and that is not
 * squeamishness. Importing `../../../web/lib/capture-status` works at runtime, because neither
 * file has a runtime import, but it drags the web file into this package's tsc program, and from
 * there `web/lib/meal-capture.ts` pulls in `web/lib/db.ts`, which needs `pg` and
 * `@neondatabase/serverless`. Those are not installed here, so `npm run typecheck` passed on my
 * machine (where the sibling node_modules happened to resolve) and failed in CI, which installs
 * this package alone. Text is also the stronger check: identical bodies cannot behave differently.
 *
 * Only the leading block comment is allowed to differ, because each copy says where it sits.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, "capture-status.ts");
const WEB = resolve(here, "../../../web/lib/capture-status.ts");

/** Everything from the first import onwards, which is the part that has to match. */
function body(path: string): string {
  const s = readFileSync(path, "utf8");
  const i = s.indexOf("import type");
  if (i < 0) throw new Error(`${path} has no import to anchor on, so the copies cannot be compared`);
  return s.slice(i);
}

describe("the app's capture-status is the website's", () => {
  it("has both copies on disk, because one missing is the failure this guards", () => {
    expect(existsSync(APP)).toBe(true);
    expect(existsSync(WEB)).toBe(true);
  });

  it("is identical from the first import onwards", () => {
    // A failure here means one copy was changed alone. Copy the web file's body over the app's,
    // keeping the app's header, which is what `capture-status.ts` says to do.
    expect(body(APP)).toBe(body(WEB));
  });

  it("keeps a header on each, so neither pretends to be the original", () => {
    for (const p of [APP, WEB]) {
      expect(readFileSync(p, "utf8").startsWith("/**")).toBe(true);
    }
    // And the app's header has to name the arrangement, or the next reader will not know.
    expect(readFileSync(APP, "utf8")).toContain("SECOND COPY");
  });
});
