import { describe, it, expect } from "vitest";
import { isMobileBrowser, NARROW_VIEWPORT_MAX_PX, type BrowserSignals } from "./mobile-browser";

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadOS13Safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

const sig = (userAgent: string, coarsePointer = false, narrowViewport = false): BrowserSignals => ({ userAgent, coarsePointer, narrowViewport });

describe("isMobileBrowser (#709)", () => {
  it("narrow means at most 1024px, so tablets in portrait fit and laptops do not", () => {
    expect(NARROW_VIEWPORT_MAX_PX).toBe(1024);
  });

  const cases: [string, BrowserSignals, boolean][] = [
    ["Android Chrome phone", sig(UA.androidChrome, true, true), true],
    ["Android Chrome, even if media queries are unavailable (UA alone decides)", sig(UA.androidChrome, false, false), true],
    ["iPhone Safari", sig(UA.iphoneSafari, true, true), true],
    ["iPadOS 13+ reports Macintosh: coarse pointer + narrow viewport catches it", sig(UA.ipadOS13Safari, true, true), true],
    ["iPad in landscape wider than 1024 with a touch pointer is not narrow → not mobile", sig(UA.ipadOS13Safari, true, false), false],
    ["macOS Safari on a laptop: fine pointer, wide → NOT mobile (the old code showed it here)", sig(UA.macSafari, false, false), false],
    ["macOS Chrome on a laptop → not mobile", sig(UA.macChrome, false, false), false],
    ["Windows Chrome → not mobile", sig(UA.windowsChrome, false, false), false],
    ["Linux Firefox → not mobile", sig(UA.linuxFirefox, false, false), false],
    ["desktop Chrome with the window shrunk to phone width still has a fine pointer → not mobile", sig(UA.macChrome, false, true), false],
    ["a touch laptop with a wide viewport → not mobile", sig(UA.windowsChrome, true, false), false],
    ["empty user agent with coarse + narrow → mobile", sig("", true, true), true],
    ["empty user agent with nothing else → not mobile", sig("", false, false), false],
  ];
  for (const [name, s, want] of cases) {
    it(name, () => {
      expect(isMobileBrowser(s)).toBe(want);
    });
  }
});
