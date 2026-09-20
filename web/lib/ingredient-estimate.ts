/**
 * The third source for a food neither USDA nor Open Food Facts has (soma#933): the local
 * Claude Code, run once with structured output, no tools and no repo context. The answer is an
 * ESTIMATE and is stored and shown as one: source "claude", confidence capped at 0.6, flag
 * `estimated`, the model's own rationale kept. It only runs where the chat runs (the Mac); the
 * Vercel demo never spawns it (see the route).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATEGORIES, ESTIMATE_SOURCE, num, sanityFlags, type Proposal } from "macro-engine-core/ingredient-research";
import { resolveClaudeCmd } from "./claude-cmd";

export const ESTIMATE_CONFIDENCE_CAP = 0.6;
export const DEFAULT_ESTIMATE_MODEL = "sonnet";

export const ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    calories_per_100g: { type: "number" }, protein_per_100g: { type: "number" }, carbs_per_100g: { type: "number" },
    fat_per_100g: { type: "number" }, fiber_per_100g: { type: "number" },
    category: { type: "string" }, is_raw: { type: "boolean" },
    confidence: { type: "number" }, rationale: { type: "string" },
  },
  required: ["name", "calories_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g", "fiber_per_100g", "category", "is_raw", "confidence", "rationale"],
} as const;

export const ESTIMATE_SYSTEM_PROMPT =
  "You are a food composition reference. Given a food name (and optional notes on how it is prepared), return typical " +
  "per-100 g values for the food as commonly eaten: kcal, protein g, carbs g, fat g, fiber g. Also return a short name for " +
  `the food, a category from: ${CATEGORIES.join(" ")}, whether it is raw (needs cooking before eating), a confidence from 0 ` +
  "to 1 (1 only for a well-characterised single food), and a one-sentence rationale naming the reference food or label you " +
  "based it on. Never invent a brand's label; if the food is a dish, estimate a typical home recipe.";

export interface EstimateOutput {
  name: string;
  calories_per_100g: number; protein_per_100g: number; carbs_per_100g: number; fat_per_100g: number; fiber_per_100g: number;
  category: string; is_raw: boolean; confidence: number; rationale: string;
}

export interface EstimateRun { output: EstimateOutput; model: string; durationMs: number }

/** The envelope `claude -p --output-format json` prints: the fields this module reads. */
interface ResultEnvelope { is_error?: boolean; result?: string; structured_output?: unknown }


function estimateModel(): string { return process.env.SOMA_ESTIMATE_MODEL || DEFAULT_ESTIMATE_MODEL; }
function neutralCwd(): string {
  const dir = join(tmpdir(), "soma-estimate");
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  return dir;
}

/** One `claude -p` run with structured output. Rejects on spawn failure, timeout, a Claude error or malformed output. */
export function runClaudeEstimate(query: string, notes: string | undefined, opts: { timeoutMs?: number } = {}): Promise<EstimateRun> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const model = estimateModel();
  const args = [
    "-p", "--output-format", "json", "--model", model, "--tools", "", "--no-session-persistence", "--strict-mcp-config",
    "--json-schema", JSON.stringify(ESTIMATE_SCHEMA), "--system-prompt", ESTIMATE_SYSTEM_PROMPT,
  ];
  const started = Date.now();
  return new Promise<EstimateRun>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const child = spawn(resolveClaudeCmd(), args, { cwd: neutralCwd(), env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); done(() => reject(new Error(`estimate timed out after ${Math.round(timeoutMs / 1000)} s`))); }, timeoutMs);
    let out = ""; let err = "";
    child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); });
    child.on("error", (e) => done(() => reject(new Error(`failed to spawn claude: ${e.message}`))));
    child.on("close", (code) => done(() => {
      let evt: ResultEnvelope | null = null;
      try { evt = JSON.parse(out.trim()) as ResultEnvelope; } catch { /* handled below */ }
      if (!evt) return reject(new Error(`claude exited ${code} without a JSON result${err ? `: ${err.trim().slice(0, 200)}` : ""}`));
      if (evt.is_error) return reject(new Error(`claude: ${(evt.result ?? "error").slice(0, 200)}`));
      const o = parseEstimateOutput(evt.structured_output ?? safeJson(evt.result));
      if (!o) return reject(new Error("claude answered without the five per-100 g values"));
      resolve({ output: o, model, durationMs: Date.now() - started });
    }));
    child.stdin.write(notes?.trim() ? `${query}\nNotes: ${notes.trim()}` : query);
    child.stdin.end();
  });
}

function safeJson(s: unknown): unknown { if (typeof s !== "string") return null; try { return JSON.parse(s); } catch { return null; } }

/** The model's output checked field by field; null when any macro is not a finite non-negative number. */
export function parseEstimateOutput(v: unknown): EstimateOutput | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const macros = ["calories_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g", "fiber_per_100g"] as const;
  const m: Partial<Record<(typeof macros)[number], number>> = {};
  for (const k of macros) { const n = num(o[k]); if (n == null || n < 0) return null; m[k] = n; }
  const conf = num(o.confidence);
  return {
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 120) : "",
    ...(m as Required<typeof m>),
    category: typeof o.category === "string" && (CATEGORIES as readonly string[]).includes(o.category) ? o.category : "snack",
    is_raw: o.is_raw === true,
    confidence: conf == null ? 0.5 : Math.min(1, Math.max(0, conf)),
    rationale: typeof o.rationale === "string" ? o.rationale.trim().slice(0, 500) : "",
  };
}

/** The estimate in the proposal shape every picker already understands, marked as an estimate. */
export function proposalFromEstimate(query: string, run: EstimateRun): Proposal & { category: string; is_raw: boolean } {
  const o = run.output;
  const macros = { calories_per_100g: o.calories_per_100g, protein_per_100g: o.protein_per_100g, carbs_per_100g: o.carbs_per_100g, fat_per_100g: o.fat_per_100g, fiber_per_100g: o.fiber_per_100g };
  return {
    name: o.name || query,
    brand: null,
    ...macros,
    source: ESTIMATE_SOURCE,
    source_id: run.model,
    source_url: "",
    confidence: Math.min(ESTIMATE_CONFIDENCE_CAP, o.confidence),
    rationale: `Estimated by Claude (${run.model}), not read from a food table. ${o.rationale}`.trim(),
    flags: [...sanityFlags(macros), "estimated"],
    category: o.category,
    is_raw: o.is_raw,
  };
}
