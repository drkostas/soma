import { describe, it, expect, vi, afterEach } from "vitest";
import { neonConfig } from "@neondatabase/serverless";
import { DEMO_READ_CACHE_S, httpDb, withDemoReadCache } from "./db";

// soma#1237: on the demo a read-only request carries a six-hour revalidate, so Next.js answers it
// from the data cache instead of waking the database. Writes and every other deployment are untouched.

const select = JSON.stringify({ query: "SELECT n FROM t WHERE id = $1", params: ["1"] });
const insert = JSON.stringify({ query: "INSERT INTO t (n) VALUES ($1)", params: ["1"] });

describe("withDemoReadCache", () => {
  it("marks a read on the demo", () => {
    const init = withDemoReadCache({ method: "POST", body: select }, true);
    expect(init?.next).toEqual({ revalidate: DEMO_READ_CACHE_S });
    expect(init?.body).toBe(select);
  });

  it("never marks a write on the demo", () => {
    const init = { method: "POST", body: insert };
    expect(withDemoReadCache(init, true)).toBe(init);
  });

  it("changes nothing outside the demo", () => {
    const init = { method: "POST", body: select };
    expect(withDemoReadCache(init, false)).toBe(init);
  });
});

describe("the HTTP driver on the demo", () => {
  const previousEndpoint = neonConfig.fetchEndpoint;
  const seen: (RequestInit | undefined)[] = [];

  const answer = () =>
    new Response(
      JSON.stringify({
        command: "SELECT", rowCount: 1, rows: [["1"]], rowAsArray: true,
        fields: [{ name: "n", dataTypeID: 25, tableID: 0, columnID: 0, dataTypeSize: -1, dataTypeModifier: -1, format: "text" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const run = async (demo: string | undefined, write: boolean) => {
    seen.length = 0;
    if (demo !== undefined) vi.stubEnv("DEMO_MODE", demo);
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      seen.push(init);
      return answer();
    }));
    neonConfig.fetchEndpoint = () => "http://127.0.0.1:9/sql";
    const sql = httpDb("postgresql://soma_ro:x@pg.example.org/soma");
    await (write ? sql`INSERT INTO t (n) VALUES (${1})` : sql`SELECT n FROM t WHERE id = ${1}`);
    return seen[0];
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    neonConfig.fetchEndpoint = previousEndpoint;
  });

  it("sends a SELECT with the six-hour revalidate", async () => {
    expect((await run("true", false))?.next).toEqual({ revalidate: DEMO_READ_CACHE_S });
  });

  it("sends a write to the database without it", async () => {
    expect((await run("true", true))?.next).toBeUndefined();
  });

  it("sends a SELECT without it outside the demo", async () => {
    expect((await run("false", false))?.next).toBeUndefined();
  });
});
