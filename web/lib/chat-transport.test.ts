import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { chatMode, requireToken } from "./chat-transport";

function mockReq(
  headers: Record<string, string>
): NextRequest {
  const h = new Headers(headers);
  return {
    headers: h,
  } as unknown as NextRequest;
}

describe("chatMode", () => {
  const origUrl = process.env.SOMA_CHAT_TUNNEL_URL;
  afterEach(() => {
    if (origUrl === undefined) delete process.env.SOMA_CHAT_TUNNEL_URL;
    else process.env.SOMA_CHAT_TUNNEL_URL = origUrl;
  });

  it("returns local when no tunnel URL is set", () => {
    delete process.env.SOMA_CHAT_TUNNEL_URL;
    expect(chatMode()).toBe("local");
  });

  it("returns proxy when a tunnel URL is set", () => {
    process.env.SOMA_CHAT_TUNNEL_URL = "https://chat.example.com";
    expect(chatMode()).toBe("proxy");
  });
});

describe("requireToken", () => {
  const origToken = process.env.SOMA_CHAT_TOKEN;
  beforeEach(() => {
    delete process.env.SOMA_CHAT_TOKEN;
  });
  afterEach(() => {
    if (origToken === undefined) delete process.env.SOMA_CHAT_TOKEN;
    else process.env.SOMA_CHAT_TOKEN = origToken;
  });

  it("allows everything when no token is configured", () => {
    expect(requireToken(mockReq({}))).toBeNull();
    expect(requireToken(mockReq({ "x-soma-chat-token": "anything" }))).toBeNull();
  });

  it("allows same-origin localhost requests even without a token header", () => {
    process.env.SOMA_CHAT_TOKEN = "secret";
    expect(
      requireToken(mockReq({ origin: "http://localhost:3456" }))
    ).toBeNull();
    expect(
      requireToken(mockReq({ origin: "https://127.0.0.1" }))
    ).toBeNull();
    expect(requireToken(mockReq({ host: "localhost:3456" }))).toBeNull();
  });

  it("rejects cross-origin without the right token", () => {
    process.env.SOMA_CHAT_TOKEN = "secret";
    const r = requireToken(
      mockReq({ origin: "https://attacker.example.com" })
    );
    expect(r).not.toBeNull();
    expect(r?.status).toBe(401);
  });

  it("rejects cross-origin with a wrong token", () => {
    process.env.SOMA_CHAT_TOKEN = "secret";
    const r = requireToken(
      mockReq({
        origin: "https://soma.example.com",
        "x-soma-chat-token": "wrong",
      })
    );
    expect(r).not.toBeNull();
    expect(r?.status).toBe(401);
  });

  it("allows cross-origin with the right token", () => {
    process.env.SOMA_CHAT_TOKEN = "secret";
    expect(
      requireToken(
        mockReq({
          origin: "https://soma.example.com",
          "x-soma-chat-token": "secret",
        })
      )
    ).toBeNull();
  });
});

// ---- #670: the browser reaches the Mac over the tailnet; Vercel no longer proxies ----
import { chatGone, tailnetIdentityOk, allowedChatOrigin, withCors, chatPreflight } from "./chat-transport";
import { NextResponse } from "next/server";

describe("chatMode gone (#670)", () => {
  const saved = { url: process.env.SOMA_CHAT_TUNNEL_URL, vercel: process.env.VERCEL };
  afterEach(() => {
    if (saved.url === undefined) delete process.env.SOMA_CHAT_TUNNEL_URL; else process.env.SOMA_CHAT_TUNNEL_URL = saved.url;
    if (saved.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved.vercel;
  });
  it("Vercel without a tunnel URL is gone, and gone answers 410", async () => {
    delete process.env.SOMA_CHAT_TUNNEL_URL; process.env.VERCEL = "1";
    expect(chatMode()).toBe("gone");
    const res = chatGone();
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/tailnet/);
  });
  it("Vercel with a tunnel URL still proxies; a dev box without VERCEL is local", () => {
    process.env.VERCEL = "1"; process.env.SOMA_CHAT_TUNNEL_URL = "https://chat.example";
    expect(chatMode()).toBe("proxy");
    delete process.env.VERCEL; delete process.env.SOMA_CHAT_TUNNEL_URL;
    expect(chatMode()).toBe("local");
  });
});

describe("tailnet identity + CORS (#670)", () => {
  const saved = { login: process.env.SOMA_CHAT_TAILNET_LOGIN, origin: process.env.SOMA_CHAT_ALLOWED_ORIGIN, token: process.env.SOMA_CHAT_TOKEN };
  beforeEach(() => {
    process.env.SOMA_CHAT_TAILNET_LOGIN = "someone@github";
    process.env.SOMA_CHAT_ALLOWED_ORIGIN = "https://soma.gkos.dev";
    process.env.SOMA_CHAT_TOKEN = "secret";
  });
  afterEach(() => {
    for (const [k, v] of [["SOMA_CHAT_TAILNET_LOGIN", saved.login], ["SOMA_CHAT_ALLOWED_ORIGIN", saved.origin], ["SOMA_CHAT_TOKEN", saved.token]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  it("the injected Tailscale-User-Login matches the configured login, case-insensitively", () => {
    expect(tailnetIdentityOk(mockReq({ "tailscale-user-login": "Someone@github", host: "gkos-mac.taile2630d.ts.net:8448" }))).toBe(true);
    expect(tailnetIdentityOk(mockReq({ "tailscale-user-login": "other@github", host: "gkos-mac.taile2630d.ts.net:8448" }))).toBe(false);
    expect(tailnetIdentityOk(mockReq({ host: "gkos-mac.taile2630d.ts.net:8448" }))).toBe(false);
  });
  it("no configured login → identity never suffices", () => {
    delete process.env.SOMA_CHAT_TAILNET_LOGIN;
    expect(tailnetIdentityOk(mockReq({ "tailscale-user-login": "someone@github" }))).toBe(false);
  });
  it("requireToken accepts the identity, still accepts the token, still refuses strangers", () => {
    const tailnetHost = { host: "gkos-mac.taile2630d.ts.net:8448" };
    expect(requireToken(mockReq({ ...tailnetHost, "tailscale-user-login": "someone@github" }))).toBeNull();
    expect(requireToken(mockReq({ ...tailnetHost, "x-soma-chat-token": "secret" }))).toBeNull();
    const denied = requireToken(mockReq({ ...tailnetHost, "tailscale-user-login": "stranger@github" }));
    expect(denied?.status).toBe(401);
  });
  it("only the configured origin gets CORS headers", () => {
    expect(allowedChatOrigin(mockReq({ origin: "https://soma.gkos.dev" }))).toBe("https://soma.gkos.dev");
    expect(allowedChatOrigin(mockReq({ origin: "https://evil.example" }))).toBeNull();
    expect(allowedChatOrigin(mockReq({}))).toBeNull();
    const res = withCors(mockReq({ origin: "https://soma.gkos.dev" }), NextResponse.json({ ok: true }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://soma.gkos.dev");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-soma-chat-token");
    const plain = withCors(mockReq({ origin: "https://evil.example" }), NextResponse.json({ ok: true }));
    expect(plain.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("preflight: 204 for the allowed origin, 403 otherwise", () => {
    expect(chatPreflight(mockReq({ origin: "https://soma.gkos.dev" })).status).toBe(204);
    expect(chatPreflight(mockReq({ origin: "https://soma.gkos.dev" })).headers.get("access-control-max-age")).toBe("600");
    expect(chatPreflight(mockReq({ origin: "https://evil.example" })).status).toBe(403);
  });
});
