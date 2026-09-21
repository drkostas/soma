/**
 * Prove the spoken path with a real recording, a real model and his real food words.
 *
 * Run: DATABASE_URL=postgresql://gkos@127.0.0.1:5432/verify_soma npx tsx scripts/hear-check.mts <wav>
 */
import { getDb } from "../lib/db";
import { getVocabulary } from "../lib/capture-vocabulary";
import { transcribeAudio, promptFor, textForAgent } from "../lib/transcribe";

const path = process.argv[2];
if (!path) { console.error("usage: hear-check.mts <path-to-audio>"); process.exit(2); }

const sql = getDb();
const words = await getVocabulary(sql);
console.log(`vocabulary: ${words.length} words, prompt is ${promptFor(words).length} characters`);
console.log(`first ten: ${words.slice(0, 10).join(", ")}`);

const started = Date.now();
const read = await transcribeAudio(path, words);
console.log(`\nheard in ${Date.now() - started}ms (script said ${read?.seconds}s, ${read?.source}):`);
console.log(`  "${read?.text}"`);

// What the phone would have done to it, and what the agent therefore reads.
const phone = "I ate a few bites of biscuit glucose and a few more from an ekmek cutie fee plus eight lucumades with honey";
console.log(`\nuntouched box -> agent reads: "${textForAgent({ text: phone, heard: phone }, read?.text ?? null)}"`);
console.log(`edited box    -> agent reads: "${textForAgent({ text: "8 loukoumades only", heard: phone }, read?.text ?? null)}"`);
process.exit(read ? 0 : 1);
