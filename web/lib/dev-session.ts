/** A signed-in session for the local verification server only (soma#854).
 *  Three conditions, all required: SOMA_DEV_SESSION=1 in the job environment, the request
 *  host is loopback, and the build is not production. Vercel and the live host never see it. */
export function devSessionAllowed(
  req: { headers: Headers },
  env: { SOMA_DEV_SESSION?: string; NODE_ENV?: string } = process.env,
): boolean {
  if (env.SOMA_DEV_SESSION !== "1") return false;
  if (env.NODE_ENV === "production") return false;
  const host = (req.headers.get("host") ?? "").split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
