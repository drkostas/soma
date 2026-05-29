import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { readChatConfig, writeChatConfig } from "@/lib/chat-config";

export const runtime = "nodejs";
export const maxDuration = 300;

// Single-flight per session id (or "fresh" before we have one). Prevents two
// tabs from racing into the same JSONL.
const inFlight = new Set<string>();

function locateClaude(): string {
  return process.env.CLAUDE_CMD || "claude";
}

function repoRoot(): string {
  return join(process.cwd(), "..");
}

interface ResultEvent {
  type?: string;
  is_error?: boolean;
  session_id?: string;
  result?: string;
  errors?: string[];
}

function isMissingSessionError(evt: ResultEvent): boolean {
  if (!evt.is_error || !Array.isArray(evt.errors)) return false;
  return evt.errors.some((e) => /No conversation found/i.test(e));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: "message (string) is required" },
      { status: 400 }
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
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(enc.encode(payload));
      };

      // Bootstrap-and-retry: try once with the configured session; if claude
      // reports "no conversation found", retry once with no --resume so we
      // create a fresh session and persist its id.
      let triedFreshFallback = false;
      let active = await runOne(cfg.sessionId);

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
          // Headless mode can't show interactive permission prompts, so
          // tools like WebFetch fail and the CLI exits 1. soma is a
          // personal-use local widget — same trust boundary as the user's
          // terminal claude — so we bypass.
          "--dangerously-skip-permissions",
        ];
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

            // Non-recoverable error: forward to the client.
            if (
              code !== 0 ||
              !lastResult ||
              lastResult.is_error
            ) {
              const errors =
                (lastResult?.errors && lastResult.errors.join("; ")) || "";
              send("fatal", {
                error:
                  errors ||
                  `claude exited with code ${code}`,
                stderr: stderrBuf.slice(-2000),
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
      inFlight.delete(lockKey);
      controller.close();
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
