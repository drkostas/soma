/**
 * A meal photo, kept where both sides can reach it.
 *
 * ⛔ THE OBVIOUS PLACE IS THE WRONG PLACE. `uploadsDir()` is `os.tmpdir()/soma-meal`, and the app
 * posts to soma.gkos.dev, so a photo uploaded from the phone was written into the filesystem of a
 * Vercel serverless instance while the agent reads that path on the Mac. The upload returned 200
 * and a path to nothing. Same gap as the capture queue in #1023, and the same answer: what has to
 * cross it goes in the database.
 *
 * A message's `image` is therefore a reference, not a path. `db:<uuid>` is a row here; anything
 * else is a plain local path, which is what the website's own uploads used to be and still works.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { QueryFn } from "./db";

export const DB_PREFIX = "db:";
export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

/** The file extension for a stored image, so the agent's copy is named honestly. */
export function extFor(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

/** True when this reference lives in the database rather than on some machine's disk. */
export function isDbRef(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ref.startsWith(DB_PREFIX);
}

/** The id inside a `db:` reference, or null when it is not one. */
export function refToId(ref: string): string | null {
  if (!isDbRef(ref)) return null;
  const id = ref.slice(DB_PREFIX.length).trim();
  // A uuid and nothing else, because this value reaches a query.
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** Why an upload was refused, in words the owner can act on. Null when it is fine. */
export function refuse(mime: string, byteSize: number): string | null {
  if (!ALLOWED_MIME.has(mime)) return `soma cannot read ${mime || "that kind of file"}. A JPEG, PNG or WebP works.`;
  if (byteSize > MAX_BYTES) {
    return `That photo is ${(byteSize / 1024 / 1024).toFixed(1)} MB and the limit is ${MAX_BYTES / 1024 / 1024} MB.`;
  }
  if (byteSize <= 0) return "That photo came through empty.";
  return null;
}

/** Store the bytes and return the reference to put in the message. */
export async function putImage(sql: QueryFn, mime: string, bytes: Buffer): Promise<string> {
  const rows = (await sql`
    INSERT INTO capture_image (mime, bytes, byte_size)
    VALUES (${mime}, ${bytes}, ${bytes.length})
    RETURNING id`) as Array<{ id: string }>;
  return `${DB_PREFIX}${rows[0].id}`;
}

/**
 * Write a `db:` reference out to a real file the agent can open, and hand back the path.
 *
 * The agent is a separate process reading from disk, which is why this exists at all. A reference
 * that is already a path is returned untouched, so the website's older uploads keep working.
 */
export async function materialise(sql: QueryFn, ref: string, dir: string): Promise<string | null> {
  const id = refToId(ref);
  if (!id) return ref;
  const rows = (await sql`SELECT mime, bytes FROM capture_image WHERE id = ${id}::uuid`) as Array<{ mime: string; bytes: Buffer }>;
  const row = rows[0];
  if (!row) return null;
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.${extFor(row.mime)}`);
  await writeFile(path, Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes));
  return path;
}
