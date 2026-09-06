import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { ensureDjPaths } from "@/lib/dj-paths";

export const runtime = "nodejs";

// State lives outside /tmp (#668): macOS purges /tmp, which read as "stopped" for a live daemon.
const { statusFile: STATUS_FILE, pidFile: PID_FILE } = ensureDjPaths();

export async function GET() {
  // Check if daemon is running
  let daemonAlive = false;
  try {
    const pidStr = readFileSync(PID_FILE, "utf8").trim();
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid)) {
      process.kill(pid, 0); // signal 0 = existence check, throws if dead
      daemonAlive = true;
    }
  } catch {}

  if (!daemonAlive) {
    return NextResponse.json({ state: "stopped" });
  }

  if (!existsSync(STATUS_FILE)) {
    return NextResponse.json({ state: "starting" });
  }

  try {
    const raw = readFileSync(STATUS_FILE, "utf8");
    const status = JSON.parse(raw) as Record<string, unknown>;
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ state: "starting" });
  }
}
