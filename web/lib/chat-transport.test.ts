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
        origin: "https://soma.gkos.dev",
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
          origin: "https://soma.gkos.dev",
          "x-soma-chat-token": "secret",
        })
      )
    ).toBeNull();
  });
});
