import { describe, it, expect } from "vitest";
import { devSessionAllowed } from "./dev-session";

const req = (host: string) => ({ headers: new Headers({ host }) });

describe("devSessionAllowed", () => {
  it("is off unless SOMA_DEV_SESSION=1", () => {
    expect(devSessionAllowed(req("127.0.0.1:3457"), { SOMA_DEV_SESSION: "", NODE_ENV: "development" })).toBe(false);
  });
  it("is on for a loopback host in a non-production build", () => {
    expect(devSessionAllowed(req("127.0.0.1:3457"), { SOMA_DEV_SESSION: "1", NODE_ENV: "development" })).toBe(true);
    expect(devSessionAllowed(req("localhost:3457"), { SOMA_DEV_SESSION: "1", NODE_ENV: "development" })).toBe(true);
  });
  it("never applies in production or to a non-loopback host", () => {
    expect(devSessionAllowed(req("127.0.0.1:3457"), { SOMA_DEV_SESSION: "1", NODE_ENV: "production" })).toBe(false);
    expect(devSessionAllowed(req("soma.gkos.dev"), { SOMA_DEV_SESSION: "1", NODE_ENV: "development" })).toBe(false);
  });
});
