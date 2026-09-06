/**
 * Where the browser sends chat traffic (#670).
 *
 * The chat runs on the Mac (it spawns `claude`), never on Vercel. It used to
 * be reached through a Vercel proxy and a cloudflared tunnel; now the browser
 * talks to the Mac directly over the tailnet, at the tailscale-serve mount.
 * NEXT_PUBLIC_SOMA_CHAT_BASE is inlined at build time; unset (local dev, the
 * demo) keeps the same-origin routes.
 */
export const CHAT_BASE = (process.env.NEXT_PUBLIC_SOMA_CHAT_BASE ?? "").replace(/\/+$/, "");

/** `/api/chat/session` → `https://gkos-mac…:8448/api/chat/session` when a base is configured. */
export function chatUrl(path: string, base: string = CHAT_BASE): string {
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Same-origin when no base is set; "tailnet" when the Mac is reached directly. */
export function chatTransport(base: string = CHAT_BASE): "same-origin" | "tailnet" {
  return base ? "tailnet" : "same-origin";
}
