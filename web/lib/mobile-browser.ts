/**
 * Is this a mobile browser? The install prompt is for phones and tablets
 * (add to home screen, or grab the native build for widgets). On a laptop it
 * is noise, and at 390px wide it sat on top of the Close Day button (#709).
 *
 * Pure function over three observations so it is table-testable without a
 * DOM; `detectMobileBrowser()` gathers them from the window.
 *
 * Rule: a mobile user agent, OR a coarse pointer (touch) on a narrow viewport.
 * The second clause catches iPadOS 13+, which reports itself as "Macintosh".
 * Neither clause matches a laptop, including macOS Safari, which has a fine
 * pointer and a wide viewport.
 */
export interface BrowserSignals {
  userAgent: string;
  coarsePointer: boolean;
  narrowViewport: boolean;
}

/** Viewports at or below this width count as narrow. Tablets in portrait fit; laptops do not. */
export const NARROW_VIEWPORT_MAX_PX = 1024;

const MOBILE_UA = /Android|iPhone|iPod|Windows Phone|Mobile/i;

export function isMobileBrowser(s: BrowserSignals): boolean {
  if (MOBILE_UA.test(s.userAgent)) return true;
  return s.coarsePointer && s.narrowViewport;
}

export function detectMobileBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const mq = (q: string) => (typeof window.matchMedia === "function" ? window.matchMedia(q).matches : false);
  return isMobileBrowser({
    userAgent: navigator.userAgent ?? "",
    coarsePointer: mq("(pointer: coarse)"),
    narrowViewport: mq(`(max-width: ${NARROW_VIEWPORT_MAX_PX}px)`),
  });
}
