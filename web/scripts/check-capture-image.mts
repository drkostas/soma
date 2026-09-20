/** Can this machine write out the newest stored photo? The agent opens a file, so this is the
 *  step that has to work for a photo taken on the phone to reach it. Read-only apart from the
 *  temporary file it writes. */
import { statSync } from "node:fs";
import { getDb } from "../lib/db";
import { materialise } from "../lib/capture-image";
import { uploadsDir } from "../lib/nutrition-agent";

const sql = getDb();
const rows = (await sql`SELECT id, byte_size FROM capture_image ORDER BY created_at DESC LIMIT 1`) as Array<{ id: string; byte_size: number }>;
if (!rows.length) { console.log("no stored photos"); process.exit(0); }
const path = await materialise(sql, `db:${rows[0].id}`, uploadsDir());
if (!path) { console.error("could not materialise it"); process.exit(1); }
const size = statSync(path).size;
console.log(`stored ${rows[0].byte_size} bytes -> ${path} (${size} bytes)`);
if (size !== Number(rows[0].byte_size)) { console.error("SIZE MISMATCH"); process.exit(1); }
console.log("the bytes survived the round trip");
