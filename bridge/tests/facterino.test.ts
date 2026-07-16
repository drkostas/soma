import { describe, it, expect } from "vitest";
import { parseGarthDump, serializeGarthDump, isOauth2Expired, type GarthBundle } from "../src/facterino";

const bundle: GarthBundle = {
  oauth1: { oauth_token: "ot", oauth_token_secret: "ots", mfa_token: null, domain: "garmin.com" },
  oauth2: {
    token_type: "Bearer", access_token: "acc", refresh_token: "ref",
    expires_in: 3600, expires_at: 2_000_000_000, scope: "s", jti: "j",
  },
};

describe("garth dump parse/serialize", () => {
  it("round-trips base64(json([oauth1, oauth2]))", () => {
    const dump = serializeGarthDump(bundle);
    const parsed = parseGarthDump(dump);
    expect(parsed.oauth1.oauth_token).toBe("ot");
    expect(parsed.oauth2.access_token).toBe("acc");
    expect(parsed.oauth2.expires_at).toBe(2_000_000_000);
  });

  it("parses a garth-format dump (matches Python garth.dumps layout)", () => {
    // garth.dumps = base64(json([asdict(oauth1), asdict(oauth2)]))
    const raw = Buffer.from(JSON.stringify([bundle.oauth1, bundle.oauth2])).toString("base64");
    expect(parseGarthDump(raw).oauth2.refresh_token).toBe("ref");
  });
});

describe("isOauth2Expired", () => {
  it("expired when expires_at is in the past (or within 60s margin)", () => {
    expect(isOauth2Expired(bundle.oauth2, 2_000_000_100)).toBe(true);  // past
    expect(isOauth2Expired(bundle.oauth2, 1_999_999_950)).toBe(true);  // within 60s margin
    expect(isOauth2Expired(bundle.oauth2, 1_999_990_000)).toBe(false); // fresh
  });
});
