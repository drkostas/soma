import { describe, it, expect } from "vitest";
import { ALL_ENDPOINTS, buildRequest } from "./garmin-endpoints";
import golden from "./garmin-endpoints.golden.json";

const g = golden as any;
const CTX = { display: "TESTUSER", cdate: "2026-07-13", aid: "123456789" };

describe("garmin-endpoints — URL/params parity vs garminconnect (34 endpoints)", () => {
  for (const [grp, specs] of Object.entries(ALL_ENDPOINTS)) {
    for (const [name, spec] of Object.entries(specs)) {
      it(`${grp}/${name} builds the exact garminconnect request`, () => {
        const built = buildRequest(spec, CTX);
        const expected = g[grp][name];
        expect(built.url).toBe(expected.url);
        expect(built.params ?? null).toEqual(expected.params ?? null);
      });
    }
  }

  it("covers every golden endpoint (no missing / extra)", () => {
    const goldenCount = Object.values(g).reduce((s: number, o: any) => s + Object.keys(o).length, 0);
    const tableCount = Object.values(ALL_ENDPOINTS).reduce((s, o) => s + Object.keys(o).length, 0);
    expect(tableCount).toBe(goldenCount);
    for (const grp of Object.keys(g)) {
      expect(Object.keys((ALL_ENDPOINTS as any)[grp]).sort()).toEqual(Object.keys(g[grp]).sort());
    }
  });
});
