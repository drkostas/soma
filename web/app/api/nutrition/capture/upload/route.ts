/**
 * A photo for a meal capture.
 *
 * ⛔ IT GOES IN THE DATABASE, NOT ON THIS MACHINE'S DISK. The app posts here against
 * soma.gkos.dev, and the agent that reads the photo runs on the Mac, so writing to
 * `os.tmpdir()` returned 200 and a path to nothing. The worker writes the bytes to a real file
 * just before the run, because the agent opens a file.
 *
 * Two shapes are accepted. `multipart/form-data` with a `file` field is what the browser sends.
 * JSON `{mime, base64}` is what the app sends, because handing a picker URI to React Native's
 * multipart uploader failed silently: the request never left the phone and no log existed anywhere.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { putImage, refuse } from "@/lib/capture-image";

export const runtime = "nodejs";

async function readBody(req: NextRequest): Promise<{ mime: string; bytes: Buffer } | { error: string; status: number }> {
  const ct = req.headers.get("content-type") || "";

  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return { error: "missing 'file' field", status: 400 };
    return { mime: file.type || "", bytes: Buffer.from(await file.arrayBuffer()) };
  }

  if (ct.startsWith("application/json")) {
    // A body over about 10 MB arrives truncated, and `req.json()` then throws a parse error about
    // a position in the string, which is a terrible thing to show someone who took a photo.
    let body: { mime?: string; base64?: string };
    try {
      body = (await req.json()) as { mime?: string; base64?: string };
    } catch {
      return { error: "That photo was too large to send. Under 10 MB works.", status: 413 };
    }
    if (typeof body.base64 !== "string" || !body.base64) return { error: "missing 'base64'", status: 400 };
    // A data URI is a common thing to send by accident; take the payload rather than refusing it.
    const raw = body.base64.includes(",") && body.base64.startsWith("data:")
      ? body.base64.slice(body.base64.indexOf(",") + 1)
      : body.base64;
    return { mime: String(body.mime ?? ""), bytes: Buffer.from(raw, "base64") };
  }

  return { error: "send multipart/form-data with a 'file' field, or JSON with {mime, base64}", status: 400 };
}

export async function POST(req: NextRequest) {
  const read = await readBody(req).catch((e: Error) => ({ error: e.message, status: 400 }));
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: read.status });

  // Say why, rather than letting every failure read the same.
  const why = refuse(read.mime, read.bytes.length);
  if (why) return NextResponse.json({ error: why }, { status: 415 });

  const path = await putImage(getDb(), read.mime, read.bytes);
  // `path` is kept as the field name because the message shape has not changed: it is a reference
  // the worker resolves, and for the website's older uploads it genuinely was a path.
  return NextResponse.json({ path });
}
