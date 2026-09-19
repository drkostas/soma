/** A photo for a meal capture. Mirrors the chat's upload, into the meal agent's own directory. */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { uploadsDir } from "@/lib/nutrition-agent";

export const runtime = "nodejs";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;

function extFor(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "expected multipart/form-data with a 'file' field" }, { status: 400 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "missing 'file' field" }, { status: 400 });
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) return NextResponse.json({ error: `unsupported type: ${mime}` }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });

  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.${extFor(mime)}`);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ path });
}
