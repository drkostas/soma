/**
 * A meal photo or a voice note, kept where both sides can reach it.
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
/**
 * ⛔ THIS IS BOUNDED BY THE DB GATEWAY, NOT BY TASTE. The bytes are inserted as a bytea parameter
 * and the Neon HTTP driver sends a Buffer as a hex string, so the request is a little over twice
 * the photo. The gateway allows 8 MB, so a photo much over 3.5 MB cannot reach the database at
 * all. Refusing it here with a number is better than a 413 from two services away.
 *
 * The phone resizes to 1280 on the long side first, so a real photo is a few hundred kilobytes.
 */
export const MAX_BYTES = 3 * 1024 * 1024;

/** Audio this accepts. Android's recogniser persists 16 kHz wav, which is what whisper wants. */
export const ALLOWED_AUDIO: ReadonlySet<string> = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/m4a", "audio/x-caf"]);

/** True when this reference is a recording rather than a picture. */
export function isAudio(mime: string): boolean {
  return ALLOWED_AUDIO.has(mime);
}
export const ALLOWED_MIME: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

/** The file extension for a stored image, so the agent's copy is named honestly. */
export function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "audio/mp4" || mime === "audio/m4a") return "m4a";
  if (mime === "audio/x-caf") return "caf";
  if (isAudio(mime)) return "wav";
  return "jpg";
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
  const audio = isAudio(mime);
  if (!ALLOWED_MIME.has(mime) && !audio) {
    return `soma cannot read ${mime || "that kind of file"}. A JPEG, PNG or WebP works.`;
  }
  const noun = audio ? "recording" : "photo";
  if (byteSize > MAX_BYTES) {
    return `That ${noun} is ${(byteSize / 1024 / 1024).toFixed(1)} MB and the limit is ${MAX_BYTES / 1024 / 1024} MB.`;
  }
  if (byteSize <= 0) return `That ${noun} came through empty.`;
  return null;
}

/** Store the bytes and return the reference to put in the message. */
export async function putMedia(sql: QueryFn, mime: string, bytes: Buffer): Promise<string> {
  const rows = (await sql`
    INSERT INTO capture_media (mime, bytes, byte_size)
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
  const rows = (await sql`SELECT mime, bytes FROM capture_media WHERE id = ${id}::uuid`) as Array<{ mime: string; bytes: Buffer }>;
  const row = rows[0];
  if (!row) return null;
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.${extFor(row.mime)}`);
  await writeFile(path, Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes));
  return path;
}

/** What a recording was heard to say, kept beside it so a bad reading can be compared later. */
export async function saveTranscript(sql: QueryFn, ref: string, transcript: string, source: string): Promise<void> {
  const id = refToId(ref);
  if (!id) return;
  await sql`
    UPDATE capture_media SET transcript = ${transcript.slice(0, 4000)}, transcript_source = ${source.slice(0, 30)}
    WHERE id = ${id}::uuid`;
}

/**
 * A reading already made, so a re-run does not make a different one.
 *
 * A follow-up re-runs the whole thread, and transcribing the same recording again would cost two
 * seconds per clip and could return slightly different words, which reads as the agent changing its
 * mind about what he said.
 */
export async function transcriptOf(sql: QueryFn, ref: string): Promise<string | null> {
  const id = refToId(ref);
  if (!id) return null;
  const rows = (await sql`SELECT transcript FROM capture_media WHERE id = ${id}::uuid`) as Array<{ transcript: string | null }>;
  const t = rows[0]?.transcript;
  return t ? String(t) : null;
}
