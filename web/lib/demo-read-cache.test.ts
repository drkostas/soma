import { describe, it, expect, vi, afterEach } from "vitest";
import { neonConfig } from "@neondatabase/serverless";
import { DEMO_READ_CACHE_S, httpDb, isCacheableRead, withDemoReadCache } from "./db";

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

  // soma#1241: the home page's weekly summary is a WITH query.
  it("marks a WITH read on the demo", () => {
    const body = JSON.stringify({ query: "WITH w AS (SELECT date FROM daily_health_summary) SELECT * FROM w", params: [] });
    expect(withDemoReadCache({ method: "POST", body }, true)?.next).toEqual({ revalidate: DEMO_READ_CACHE_S });
  });

  it.each([
    ["a data-modifying WITH", "WITH n AS (INSERT INTO t (n) VALUES ($1) RETURNING n) SELECT * FROM n"],
    ["a SELECT that locks rows", "SELECT n FROM t WHERE id = $1 FOR UPDATE"],
    ["a SELECT that takes a sequence value", "SELECT nextval('t_id_seq')"],
    ["two statements", "SELECT 1; DELETE FROM t"],
  ])("never marks %s", (_name, query) => {
    const init = { method: "POST", body: JSON.stringify({ query, params: ["1"] }) };
    expect(withDemoReadCache(init, true)).toBe(init);
  });

  it("does not mistake a column name for a write", () => {
    const body = JSON.stringify({ query: "SELECT created_at, updated_at, deleted FROM t", params: [] });
    expect(isCacheableRead(body)).toBe(true);
  });

  it("marks a batch only when every query in it is a read", () => {
    const reads = JSON.stringify({ queries: [{ query: "SELECT 1" }, { query: "WITH a AS (SELECT 2) SELECT * FROM a" }] });
    const mixed = JSON.stringify({ queries: [{ query: "SELECT 1" }, { query: "UPDATE t SET n = 1" }] });
    expect(isCacheableRead(reads)).toBe(true);
    expect(isCacheableRead(mixed)).toBe(false);
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

  const run = async (demo: string | undefined, kind: "select" | "with" | "write") => {
    seen.length = 0;
    if (demo !== undefined) vi.stubEnv("DEMO_MODE", demo);
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      seen.push(init);
      return answer();
    }));
    neonConfig.fetchEndpoint = () => "http://127.0.0.1:9/sql";
    const sql = httpDb("postgresql://soma_ro:x@pg.example.org/soma");
    if (kind === "write") await sql`INSERT INTO t (n) VALUES (${1})`;
    else if (kind === "with") await sql`WITH w AS (SELECT n FROM t WHERE id = ${1}) SELECT * FROM w`;
    else await sql`SELECT n FROM t WHERE id = ${1}`;
    return seen[0];
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    neonConfig.fetchEndpoint = previousEndpoint;
  });

  it("sends a SELECT with the six-hour revalidate", async () => {
    expect((await run("true", "select"))?.next).toEqual({ revalidate: DEMO_READ_CACHE_S });
  });

  it("sends a WITH read with the six-hour revalidate", async () => {
    expect((await run("true", "with"))?.next).toEqual({ revalidate: DEMO_READ_CACHE_S });
  });

  it("sends a write to the database without it", async () => {
    expect((await run("true", "write"))?.next).toBeUndefined();
  });

  it("sends a SELECT without it outside the demo", async () => {
    expect((await run("false", "select"))?.next).toBeUndefined();
  });
});
