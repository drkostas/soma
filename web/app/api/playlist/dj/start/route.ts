import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFileSync, readFileSync, openSync } from "fs";
import path from "path";

export const runtime = "nodejs";

const STATUS_FILE = "/tmp/soma-dj-status.json";
const PID_FILE = "/tmp/soma-dj-pid";
const LOG_FILE = "/tmp/soma-dj.log";
const DAEMON_SCRIPT = path.join(process.cwd(), "../sync/src/dj_daemon.py");

export async function POST(req: NextRequest) {
  // Guard against double-start: if a daemon is already running, return early
  try {
    const existing = readFileSync(PID_FILE, "utf8").trim();
    const existingPid = parseInt(existing, 10);
    if (!isNaN(existingPid)) {
      process.kill(existingPid, 0); // throws if dead
      return NextResponse.json({ ok: true, pid: existingPid, alreadyRunning: true });
    }
  } catch {}

  const body = await req.json().catch(() => ({})) as {
    hr_rest?: number;
    hr_max?: number;
    offset?: number;
    genres?: string[];
    sources?: string[];
  };

  const hrRest = Math.max(20, Math.min(120, Number(body.hr_rest ?? 60)));
  const hrMax = Math.max(140, Math.min(230, Number(body.hr_max ?? 190)));
  const offsetRaw = Number(body.offset ?? 0);
  const offset = [-12, 0, 12].includes(offsetRaw) ? offsetRaw : 0;

  const toArray = (v: unknown, fallback: string[] = []): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string" && v.trim()) return [v.trim()];
    return fallback;
  };

  const args = [
    DAEMON_SCRIPT,
    "--hr-rest", String(hrRest),
    "--hr-max", String(hrMax),
    "--offset", String(offset),
    "--genres", toArray(body.genres).join(","),
    "--sources", toArray(body.sources, ["liked"]).join(","),
    "--status-file", STATUS_FILE,
    "--pid-file", PID_FILE,
  ];

  const logFd = openSync(LOG_FILE, "a");
  const proc = spawn("python3", args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });

  proc.on("error", (err) => {
    console.error("Failed to start DJ daemon:", err);
  });

  proc.unref();

  if (!proc.pid) {
    return NextResponse.json({ error: "failed to spawn daemon" }, { status: 500 });
  }

  // Write PID immediately as backup (daemon also writes it)
  if (proc.pid) {
    try { writeFileSync(PID_FILE, String(proc.pid)); } catch {}
  }

  return NextResponse.json({ ok: true, pid: proc.pid });
}
