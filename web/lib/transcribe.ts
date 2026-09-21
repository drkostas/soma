/**
 * What he actually said, read by a real model on the Mac rather than by the phone.
 *
 * ⛔ NO CLAUDE MODEL TAKES AUDIO. This was worth checking before building anything, because the
 * ask was for the voice itself to reach the agent the way it reaches the Claude app. It does not:
 * the Claude app transcribes too. So the honest best is a far better transcript, and keeping the
 * recording so a bad one can be re-read later instead of being the only record of the meal.
 *
 * The phone's recogniser still runs, because he needs to see words appear while he talks and to be
 * able to fix one before sending. Its transcript is the fallback, not the source: see
 * `textForAgent`, which hands his own edit back the moment he touches the box.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

/** Homebrew's python, which is where faster_whisper is installed. Overridable for a test rig. */
export function pythonBin(): string {
  return process.env.SOMA_PYTHON || "/opt/homebrew/bin/python3";
}

/**
 * ⛔ THE PROMPT IS BOUNDED IN CHARACTERS, NOT WORDS, AND TRUNCATION DROPS THE FRONT.
 *
 * faster-whisper cuts a prompt to the last 223 tokens, so a prompt that is too long loses its
 * BEGINNING, which is exactly where the words that matter are: `buildVocabulary` puts the seeded
 * Greek names first. Measured on this model, these words cost 0.40 tokens per character, so a
 * sixty-word list came to about 320 tokens and quietly threw "loukoumades" and "mpiskotogluko"
 * away. This budget is about 170 tokens, well inside the window.
 */
export const MAX_PROMPT_CHARS = 420;

/**
 * The prompt that stops "mpiskotogluko" coming back as "biscuit glucose".
 *
 * Whisper conditions on this text as though it were the previous sentence, so it is written as a
 * sentence rather than a bare list.
 */
export function promptFor(words: readonly string[]): string {
  const kept: string[] = [];
  let chars = 0;
  for (const w of words) {
    const word = w.trim();
    if (word.length <= 2) continue;
    if (chars + word.length + 2 > MAX_PROMPT_CHARS) break;
    kept.push(word);
    chars += word.length + 2;
  }
  if (!kept.length) return "";
  return `He is describing a meal. Foods he eats: ${kept.join(", ")}.`;
}

export interface Transcription {
  text: string;
  /** Which model read it, so a stored transcript says where it came from. */
  source: string;
  seconds: number;
}

/** The parsed reading, or null when the script said nothing usable. */
export function parseTranscription(stdout: string): Transcription | null {
  const line = stdout.trim().split("\n").filter(Boolean).pop();
  if (!line) return null;
  let o: unknown;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim() : "";
  if (!text) return null;
  return {
    text,
    source: `whisper-${String(r.model ?? "small")}`,
    seconds: Number(r.seconds ?? 0),
  };
}

/**
 * The text his own words became, or null on any failure.
 *
 * Null is a normal answer, not an error to propagate: a missing python, a model that will not load
 * or a file that will not decode must all leave the phone's transcript standing rather than lose
 * the meal. The caller logs it and carries on.
 */
export async function transcribeAudio(
  path: string,
  words: readonly string[],
  opts: { script?: string; timeoutMs?: number } = {},
): Promise<Transcription | null> {
  const script = opts.script ?? join(process.cwd(), "scripts", "transcribe-audio.py");
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const args = [script, path, "--prompt", promptFor(words)];
  return await new Promise<Transcription | null>((resolve) => {
    const child = spawn(pythonBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", (e) => {
      clearTimeout(timer);
      console.error(`[transcribe] could not run ${pythonBin()}: ${e.message}`);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error(`[transcribe] exit ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`);
        resolve(null);
        return;
      }
      resolve(parseTranscription(out));
    });
  });
}

/**
 * Which words the agent should read for one message.
 *
 * ⛔ HIS EDIT ALWAYS WINS. The phone fills the box while he speaks and he can correct a word before
 * sending, so replacing the box's text with whisper's reading would throw that correction away.
 * `heard` is what the recogniser put there; when the box still matches it he never touched it, and
 * the better reading is safe to use.
 */
export function textForAgent(
  m: { text: string; heard?: string | null },
  whisper: string | null,
): string {
  const said = (whisper ?? "").trim();
  if (!said) return m.text;
  const heard = (m.heard ?? "").trim();
  if (!heard) return said;
  return m.text.trim() === heard ? said : m.text;
}
