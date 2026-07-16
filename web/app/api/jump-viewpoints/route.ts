import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";

// Dev-only helper for the jump-viewer tool (public/jump-viewer.html): stores the
// user's preferred 3D viewpoints per jump so the share-image camera heuristic
// can be tuned to match them.
export const runtime = "nodejs";

const FILE = "/tmp/soma/jump-viewpoints.jsonl";

export async function POST(req: Request) {
  const body = await req.json();
  mkdirSync("/tmp/soma", { recursive: true });
  appendFileSync(FILE, JSON.stringify({ ...body, saved_at: new Date().toISOString() }) + "\n");
  return Response.json({ ok: true });
}

export async function GET() {
  if (!existsSync(FILE)) return Response.json([]);
  const lines = readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean);
  return Response.json(lines.map((l) => JSON.parse(l)));
}
