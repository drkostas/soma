import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import path from "path";

export const runtime = "nodejs";

const STATUS_FILE = "/tmp/soma-dj-status.json";
const PID_FILE = "/tmp/soma-dj-pid";
const DAEMON_SCRIPT = path.join(process.cwd(), "../sync/src/dj_daemon.py");

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    hr_rest?: number;
    hr_max?: number;
    offset?: number;
    genres?: string[];
    sources?: string[];
  };

  const args = [
    DAEMON_SCRIPT,
    "--hr-rest", String(body.hr_rest ?? 60),
    "--hr-max", String(body.hr_max ?? 190),
    "--offset", String(body.offset ?? 0),
    "--genres", (body.genres ?? []).join(","),
    "--sources", (body.sources ?? ["liked"]).join(","),
    "--status-file", STATUS_FILE,
    "--pid-file", PID_FILE,
  ];

  const proc = spawn("python3", args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  proc.on("error", (err) => {
    console.error("Failed to start DJ daemon:", err);
  });

  proc.unref();

  // Write PID immediately as backup (daemon also writes it)
  if (proc.pid) {
    try { writeFileSync(PID_FILE, String(proc.pid)); } catch {}
  }

  return NextResponse.json({ ok: true, pid: proc.pid });
}
