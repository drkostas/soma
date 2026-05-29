import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChatConfig, writeChatConfig } from "@/lib/chat-config";
import { chatMode, proxyToLocal, requireToken } from "@/lib/chat-transport";

export const runtime = "nodejs";
// Hobby-plan ceiling for serverless function lifetime. Cold-cache claude
// calls can run 10-30s for first-token latency; the heartbeat below keeps
// the stream from being idle-timed while we wait.
export const maxDuration = 300;

// Single-flight per session id (or "fresh" before we have one). Prevents two
// tabs from racing into the same JSONL.
const inFlight = new Set<string>();

// Token-bucket rate limit: at most N turns per rolling minute. The chat is
// single-user / local-only, but this caps the damage from a loop bug or
// accidental scripted spam.
const TURNS_PER_MINUTE = 20;
const turnTimestamps: number[] = [];
function checkRateLimit(): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  while (turnTimestamps.length && now - turnTimestamps[0] > 60_000) {
    turnTimestamps.shift();
  }
  if (turnTimestamps.length >= TURNS_PER_MINUTE) {
    const retryAfter = Math.ceil((60_000 - (now - turnTimestamps[0])) / 1000);
    return { ok: false, retryAfterSec: retryAfter };
  }
  turnTimestamps.push(now);
  return { ok: true };
}

function locateClaude(): string {
  return process.env.CLAUDE_CMD || "claude";
}

function repoRoot(): string {
  return join(process.cwd(), "..");
}

// Where pasted images are saved by the upload route. Created on demand so
// the spawned claude's --add-dir doesn't fail if the dir doesn't exist yet.
function uploadsDir(): string {
  const dir = join(tmpdir(), "soma-chat");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  return dir;
}

// Path to the repo-checked-in system prompt that primes the soma chat
// assistant (role, context, db schemas, conventions). Lives in web/lib/ so
// it ships with a fresh clone. Optional — we only attach the flag if the
// file actually exists, so the route still works if someone removes it.
function systemPromptFile(): string | null {
  const path = join(process.cwd(), "lib", "chat-system-prompt.md");
  return existsSync(path) ? path : null;
}

interface ResultEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  session_id?: string;
  result?: string;
  errors?: string[];
  api_error_status?: number | string | null;
}

function isMissingSessionError(evt: ResultEvent): boolean {
  if (!evt.is_error || !Array.isArray(evt.errors)) return false;
  return evt.errors.some((e) => /No conversation found/i.test(e));
}

export async function POST(req: NextRequest) {
  // Vercel deployment: just forward to the Mac via the cloudflared tunnel.
  if (chatMode() === "proxy") return proxyToLocal(req, "/api/chat");
  // Local (Mac or dev): enforce the shared secret on non-same-origin calls.
  const denied = requireToken(req);
  if (denied) return denied;

  const body = (await req.json()) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: "message (string) is required" },
      { status: 400 }
    );
  }

  const rl = checkRateLimit();
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: `Rate limit: ${TURNS_PER_MINUTE}/min. Try again in ${rl.retryAfterSec}s.`,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const cfg = await readChatConfig();
  const lockKey = cfg.sessionId || "__bootstrap__";
  if (inFlight.has(lockKey)) {
    return NextResponse.json(
      { error: "Another chat turn is already in flight for this session." },
      { status: 409 }
    );
  }
  inFlight.add(lockKey);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      // Once the controller is closed (client disconnect, panel close,
      // upstream fetch cancelled, etc.) any further enqueue throws. Wrap
      // every write so an aborted client never breaks the rest of the
      // stream-handling path (which is what was leaking the inFlight lock).
      let controllerClosed = false;
      const send = (event: string, data: unknown) => {
        if (controllerClosed) return;
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(enc.encode(payload));
        } catch {
          controllerClosed = true;
        }
      };

      // Belt-and-braces: if the client aborts, mark the controller dead so
      // pending child.on("close") writes are no-ops.
      req.signal.addEventListener("abort", () => {
        controllerClosed = true;
      });

      // SSE heartbeat: send a comment line every 10s so Vercel / Cloudflare
      // edges don't close idle connections during the model's first-token
      // wait (which can be 5-15s cold-cache). Comments are ignored by the
      // browser's EventSource parser.
      const heartbeat = setInterval(() => {
        if (controllerClosed) return;
        try {
          controller.enqueue(enc.encode(": keepalive\n\n"));
        } catch {
          controllerClosed = true;
        }
      }, 10_000);

      // Bootstrap-and-retry: try once with the configured session; if claude
      // reports "no conversation found", retry once with no --resume so we
      // create a fresh session and persist its id.
      let triedFreshFallback = false;
      let active = false;
      try {
        active = await runOne(cfg.sessionId);
      } catch (err) {
        send("fatal", { error: `chat runner crashed: ${String(err)}` });
      }

      async function runOne(sessionId: string): Promise<boolean> {
        const args = [
          "-p",
          "--verbose", // required by claude when -p + --output-format=stream-json
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--input-format",
          "text",
          "--add-dir",
          repoRoot(),
          "--add-dir",
          uploadsDir(),
          // Headless mode can't show interactive permission prompts, so
          // tools like WebFetch fail and the CLI exits 1. soma is a
          // personal-use local widget — same trust boundary as the user's
          // terminal claude — so we bypass.
          "--dangerously-skip-permissions",
        ];
        // Prime the assistant with soma's role, context, DB schemas, and
        // conventions on EVERY call. This file ships with the repo so a
        // fresh clone gets the same behavior without depending on the
        // user's prior session history.
        const promptFile = systemPromptFile();
        if (promptFile) {
          args.push("--append-system-prompt-file", promptFile);
        }
        if (sessionId) {
          args.push("--resume", sessionId);
        }

        return await new Promise<boolean>((resolve) => {
          const child = spawn(locateClaude(), args, {
            cwd: repoRoot(),
            env: { ...process.env },
            stdio: ["pipe", "pipe", "pipe"],
          });

          child.stdin.write(message);
          child.stdin.end();

          let stdoutBuf = "";
          let stderrBuf = "";
          let lastResult: ResultEvent | null = null;

          child.stdout.on("data", (chunk: Buffer) => {
            stdoutBuf += chunk.toString("utf8");
            let nl: number;
            while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
              const line = stdoutBuf.slice(0, nl).trim();
              stdoutBuf = stdoutBuf.slice(nl + 1);
              if (!line) continue;
              try {
                const evt = JSON.parse(line) as { type?: string };
                if (evt.type === "result") {
                  lastResult = evt as ResultEvent;
                  // Don't forward the result event yet — we may need to
                  // swallow a "session not found" before retrying.
                  continue;
                }
                send("event", evt);
              } catch {
                send("raw", { line });
              }
            }
          });

          child.stderr.on("data", (chunk: Buffer) => {
            stderrBuf += chunk.toString("utf8");
          });

          child.on("error", (err) => {
            send("fatal", {
              error: `failed to spawn claude: ${String(err)}`,
              stderr: stderrBuf.slice(-2000),
            });
            resolve(false);
          });

          child.on("close", async (code) => {
            // Self-heal: if we tried --resume <stale> and claude reported
            // "no conversation found", drop the stored id and retry once
            // with a fresh session.
            if (
              lastResult &&
              isMissingSessionError(lastResult) &&
              !triedFreshFallback
            ) {
              triedFreshFallback = true;
              await writeChatConfig({ sessionId: "" });
              const ok = await runOne("");
              resolve(ok);
              return;
            }

            // Non-recoverable error: forward to the client with full
            // diagnostics so the error pill can show something actionable.
            if (
              code !== 0 ||
              !lastResult ||
              lastResult.is_error
            ) {
              const errors =
                (lastResult?.errors && lastResult.errors.join("; ")) || "";
              const headline = errors || `claude exited with code ${code}`;
              // Build a multi-source stderr-ish detail so we never show an
              // empty box. Order: real stderr → result.errors → result
              // subtype/api_error_status if present.
              const detailParts: string[] = [];
              if (stderrBuf.trim()) detailParts.push(stderrBuf.trim());
              if (lastResult?.errors?.length && !errors) {
                detailParts.push(`errors: ${JSON.stringify(lastResult.errors)}`);
              }
              if (lastResult?.subtype) {
                detailParts.push(`subtype: ${lastResult.subtype}`);
              }
              if (lastResult?.api_error_status) {
                detailParts.push(`api_error_status: ${lastResult.api_error_status}`);
              }
              if (typeof code === "number") {
                detailParts.push(`exit_code: ${code}`);
              }
              const detail = detailParts.join("\n");

              // Server-side log so the dev terminal shows what the user saw.
              // eslint-disable-next-line no-console
              console.error(
                `[chat] spawn failed: ${headline}\n${detail.slice(0, 4000)}`
              );

              send("fatal", {
                error: headline,
                stderr: detail.slice(-2000),
              });
              resolve(false);
              return;
            }

            // Success path: persist the session_id so the next call resumes.
            if (lastResult.session_id) {
              try {
                await writeChatConfig({ sessionId: lastResult.session_id });
              } catch {
                // ignore: persistence is best-effort
              }
            }
            send("event", lastResult);
            resolve(true);
          });

          req.signal.addEventListener("abort", () => {
            try {
              child.kill("SIGTERM");
            } catch {
              // ignore
            }
          });
        });
      }

      send("done", { ok: active });
      clearInterval(heartbeat);
      inFlight.delete(lockKey);
      controllerClosed = true;
      try {
        controller.close();
      } catch {
        // already closed (client gone) — fine
      }
    },
    cancel() {
      // Browser aborted (closed tab, navigated away, panel re-render).
      // Free the lock even though start()'s closure may still be awaiting
      // the child process — that closure is now no-op'd by the
      // controllerClosed guard around send().
      inFlight.delete(lockKey);
      // (The heartbeat interval is cleared inside start()'s cleanup once
      // the awaited promise resolves; the child process is killed via
      // req.signal so that path runs even on disconnect.)
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
