import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { readChatConfig } from "@/lib/chat-config";

export const runtime = "nodejs";
export const maxDuration = 300;

// Single-flight per session id: prevents two browser tabs from racing each
// other into the same JSONL session file.
const inFlight = new Set<string>();

function locateClaude(): string {
  // Allow override (useful if soma runs under a service manager without ~/.local/bin on PATH).
  return process.env.CLAUDE_CMD || "claude";
}

function repoRoot(): string {
  // web/ is the Next.js root; project root is one level up.
  return join(process.cwd(), "..");
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

  const { sessionId } = await readChatConfig();
  if (inFlight.has(sessionId)) {
    return NextResponse.json(
      {
        error: "Another chat turn is already in flight for this session.",
      },
      { status: 409 }
    );
  }
  inFlight.add(sessionId);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(enc.encode(payload));
      };

      const child = spawn(
        locateClaude(),
        [
          "-p",
          "--resume",
          sessionId,
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--input-format",
          "text",
          "--add-dir",
          repoRoot(),
        ],
        {
          cwd: repoRoot(),
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      child.stdin.write(message);
      child.stdin.end();

      let stdoutBuf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8");
        let nl: number;
        while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
          const line = stdoutBuf.slice(0, nl).trim();
          stdoutBuf = stdoutBuf.slice(nl + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            send("event", evt);
          } catch {
            // Forward as raw text if it isn't JSON (debug output, etc.)
            send("raw", { line });
          }
        }
      });

      let stderrBuf = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        send("fatal", { error: String(err) });
        inFlight.delete(sessionId);
        controller.close();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          send("fatal", {
            error: `claude exited with code ${code}`,
            stderr: stderrBuf.slice(-2000),
          });
        }
        send("done", { exitCode: code ?? 0 });
        inFlight.delete(sessionId);
        controller.close();
      });

      // If the client aborts, kill the subprocess.
      req.signal.addEventListener("abort", () => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      });
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
