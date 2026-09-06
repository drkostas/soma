import { describe, it, expect } from "vitest";
import { chatUrl, chatTransport } from "./chat-origin";

describe("chat-origin (#670)", () => {
  it("no base → same-origin path untouched", () => {
    expect(chatUrl("/api/chat/session", "")).toBe("/api/chat/session");
    expect(chatTransport("")).toBe("same-origin");
  });
  it("a base prefixes the path, trailing slash or not", () => {
    expect(chatUrl("/api/chat", "https://gkos-mac.taile2630d.ts.net:8448")).toBe("https://gkos-mac.taile2630d.ts.net:8448/api/chat");
    expect(chatUrl("api/chat", "https://h:8448")).toBe("https://h:8448/api/chat");
    expect(chatTransport("https://h:8448")).toBe("tailnet");
  });
});
