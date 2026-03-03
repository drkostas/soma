import { NextResponse } from "next/server";
import { readFileSync, unlinkSync } from "fs";

export const runtime = "nodejs";

const STATUS_FILE = "/tmp/soma-dj-status.json";
const PID_FILE = "/tmp/soma-dj-pid";

export async function POST() {
  try {
    const pidStr = readFileSync(PID_FILE, "utf8").trim();
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid)) {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // PID file missing or process already dead — ok
  }

  // Clean up files
  try { unlinkSync(PID_FILE); } catch {}
  try { unlinkSync(STATUS_FILE); } catch {}

  return NextResponse.json({ ok: true });
}
