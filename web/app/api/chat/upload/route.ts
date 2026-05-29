import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatMode, proxyToLocal, requireToken } from "@/lib/chat-transport";

export const runtime = "nodejs";

// Where pasted/uploaded images get saved on the host. The spawned claude has
// Read tool access to this path because the API route uses --add-dir on the
// soma repo root AND tmpdir() is universally readable.
const DEST_DIR = join(tmpdir(), "soma-chat");

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function extFor(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "bin";
}

export async function POST(req: NextRequest) {
  if (chatMode() === "proxy") return proxyToLocal(req, "/api/chat/upload");
  const denied = requireToken(req);
  if (denied) return denied;
  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "expected multipart/form-data with a 'file' field" },
      { status: 400 }
    );
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json({ error: `bad form-data: ${String(err)}` }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing 'file' field" }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) {
    return NextResponse.json(
      { error: `unsupported type: ${mime}. Allowed: ${[...ALLOWED].join(", ")}` },
      { status: 415 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${file.size} > ${MAX_BYTES})` },
      { status: 413 }
    );
  }

  await mkdir(DEST_DIR, { recursive: true });
  const name = `${randomUUID()}.${extFor(mime)}`;
  const path = join(DEST_DIR, name);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(path, buf);

  return NextResponse.json({ path, name, mime, size: file.size });
}
