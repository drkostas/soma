/**
 * The meal reader: one `claude -p` per capture, with the owner's context, a strict answer shape
 * and a short leash.
 *
 * It follows `lib/ingredient-estimate.ts`, which has spawned Claude this way in production since
 * soma#933, with two differences: it is given tools, and it is given the owner's whole context.
 *
 * ⛔ IT CANNOT WRITE ANYTHING. No repo in its working directory, no Bash, no Edit, no permission
 * bypass. It reads, it looks up, it proposes. soma validates and writes.
 */
import { spawn } from "node:child_process";
import { CATEGORIES } from "macro-engine-core/ingredient-research";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Quantity } from "./meal-quantity";
import { resolveClaudeCmd } from "./claude-cmd";

export const SLOTS = ["breakfast", "lunch", "dinner", "pre_sleep", "during_workout"] as const;
export type Slot = (typeof SLOTS)[number];
const QUANTITY_KINDS = ["grams", "count", "portion", "share_of_total", "bites", "unknown"] as const;
const PORTION_VALUES = ["small", "moderate", "large"] as const;

export interface Macros { calories: number; protein: number; carbs: number; fat: number; fiber: number }

export interface ProposalItem {
  query: string;
  ingredient_id: string | null;
  quantity: Quantity;
  note: string | null;
  macros_per_100g: Macros | null;
  /** What ONE of them weighs, when the amount is a count of a food not already in the catalog.
   *  Without it a count cannot be converted, and the old fallback of 100 g each turned 8
   *  loukoumades into 800 g. The agent knows a loukoumada is about 20 g; it was never asked. */
  grams_per_unit: number | null;
  /** What to call one of them: "donut", "slice", "egg". Only meaningful beside a unit weight. */
  unit_name: string | null;
  /** The food's category, which is what selects both the solver's bounds and his portion band.
   *  `ensureIngredient` used to hardcode "restaurant", which is why nuts were sized like a
   *  restaurant dish at 113 g. */
  category: string | null;
  source: string;
  confidence: number;
}

export interface MealProposal {
  slot: Slot;
  tense: "planning" | "eaten";
  preset_name: string | null;
  total_grams: number | null;
  items: ProposalItem[];
  summary: string;
  question: string | null;
}

export const MEAL_PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    slot: { type: "string", enum: [...SLOTS] },
    tense: { type: "string", enum: ["planning", "eaten"] },
    preset_name: { type: ["string", "null"] },
    total_grams: { type: ["number", "null"] },
    summary: { type: "string" },
    question: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          ingredient_id: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
          source: { type: "string" },
          confidence: { type: "number" },
          quantity: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...QUANTITY_KINDS] },
              value: { type: ["number", "string", "null"] },
            },
            required: ["kind"],
          },
          macros_per_100g: {
            type: ["object", "null"],
            properties: {
              calories: { type: "number" }, protein: { type: "number" }, carbs: { type: "number" },
              fat: { type: "number" }, fiber: { type: "number" },
            },
          },
          grams_per_unit: { type: ["number", "null"] },
          unit_name: { type: ["string", "null"] },
          category: { type: ["string", "null"] },
        },
        required: ["query", "ingredient_id", "quantity", "source", "confidence"],
      },
    },
  },
  required: ["slot", "tense", "items", "summary"],
} as const;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function parseQuantity(v: unknown): Quantity | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = String(o.kind);
  if (kind === "unknown") return { kind: "unknown" };
  if (kind === "portion") {
    const s = String(o.value);
    return (PORTION_VALUES as readonly string[]).includes(s)
      ? { kind: "portion", value: s as "small" | "moderate" | "large" } : null;
  }
  const n = num(o.value);
  if (n == null || n < 0) return null;
  if (kind === "grams") return { kind: "grams", value: n };
  if (kind === "count") return { kind: "count", value: n };
  if (kind === "bites") return { kind: "bites", value: n };
  if (kind === "share_of_total") return { kind: "share_of_total", value: n };
  return null;
}

function parseMacros(v: unknown): Macros | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of ["calories", "protein", "carbs", "fat", "fiber"]) {
    const n = num(o[k]);
    if (n == null || n < 0) return null;
    out[k] = n;
  }
  return out as unknown as Macros;
}

/** The reply, checked field by field. Null means it is not usable, which counts as a failed try. */
export function parseProposal(v: unknown): MealProposal | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!(SLOTS as readonly string[]).includes(String(o.slot))) return null;
  const tense = String(o.tense) === "planning" ? "planning" : "eaten";
  const totalGrams = o.total_grams == null ? null : num(o.total_grams);

  const question = typeof o.question === "string" && o.question.trim() ? o.question.trim().slice(0, 500) : null;
  if (!Array.isArray(o.items)) return null;
  // An empty list is legitimate in exactly one case: the agent could identify nothing and says so.
  // The instructions allow that one question, so rejecting it here stranded the owner's sentence,
  // which is the opposite of the point. Found by sending a photo it could not read.
  if (!o.items.length) return question ? {
    slot: String(o.slot) as Slot, tense, total_grams: totalGrams,
    preset_name: typeof o.preset_name === "string" && o.preset_name ? o.preset_name : null,
    items: [], summary: String(o.summary ?? "").slice(0, 500), question,
  } : null;

  const items: ProposalItem[] = [];
  for (const raw of o.items) {
    if (!raw || typeof raw !== "object") return null;
    const i = raw as Record<string, unknown>;
    const quantity = parseQuantity(i.quantity);
    if (!quantity) return null;
    // A share is meaningless without something to take a share of.
    if (quantity.kind === "share_of_total" && totalGrams == null) return null;
    const ingredientId = typeof i.ingredient_id === "string" && i.ingredient_id ? i.ingredient_id : null;
    const macros = parseMacros(i.macros_per_100g);
    // An unmatched food has to bring its own numbers or there is nothing to compute from.
    if (!ingredientId && !macros) return null;
    const conf = num(i.confidence);
    const gpu = num(i.grams_per_unit);
    items.push({
      query: String(i.query ?? "").slice(0, 200),
      ingredient_id: ingredientId,
      quantity,
      note: typeof i.note === "string" && i.note ? i.note.slice(0, 300) : null,
      macros_per_100g: macros,
      // A unit weight has to be a real, positive, human-sized number. 2 kg is not one of them.
      grams_per_unit: gpu != null && gpu > 0 && gpu <= 2000 ? Math.round(gpu) : null,
      unit_name: typeof i.unit_name === "string" && i.unit_name ? i.unit_name.slice(0, 30) : null,
      category: typeof i.category === "string" && (CATEGORIES as readonly string[]).includes(i.category) ? i.category : null,
      source: String(i.source ?? "unknown").slice(0, 60),
      confidence: conf == null ? 0.5 : Math.min(1, Math.max(0, conf)),
    });
  }

  return {
    slot: String(o.slot) as Slot, tense, total_grams: totalGrams,
    preset_name: typeof o.preset_name === "string" && o.preset_name ? o.preset_name : null,
    items,
    summary: String(o.summary ?? "").slice(0, 500),
    question,
  };
}

interface ResultEnvelope { is_error?: boolean; result?: string; structured_output?: unknown }



/** Where a capture's photo lives. The agent gets --add-dir for this and nothing else. */
export function uploadsDir(): string {
  const dir = join(tmpdir(), "soma-meal");
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  return dir;
}
function neutralCwd(): string {
  const dir = join(tmpdir(), "soma-meal-agent");
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  return dir;
}

/**
 * The MCP config, written fresh with ABSOLUTE paths.
 *
 * ⛔ IT CANNOT BE A CHECKED-IN FILE WITH RELATIVE PATHS. The agent runs in a scratch directory,
 * deliberately, so that it has no repo. A relative server path resolves against that scratch
 * directory and the tool server is simply never found, which shows up as an agent that quietly
 * has no tools rather than as an error. The repo copy exists to be read, not to be used.
 */
export function writeMcpConfig(repoRoot: string): string {
  const dir = neutralCwd();
  const path = join(dir, "mcp-config.json");
  writeFileSync(path, JSON.stringify({
    mcpServers: {
      nutrition: {
        command: "npx",
        args: ["-y", "tsx", join(repoRoot, "mcp", "nutrition-tools", "server.mts")],
        cwd: repoRoot,
      },
    },
  }, null, 2), "utf8");
  return path;
}

export interface AgentRun { proposal: MealProposal; model: string; durationMs: number }

/** One agent turn. `thread` is the whole conversation so a follow-up refines rather than restarts. */
export function runMealAgent(
  contextBlock: string,
  thread: Array<{ role: "user" | "agent"; text: string; image: string | null }>,
  opts: { timeoutMs?: number; mcpConfig?: string; promptFile?: string } = {},
): Promise<AgentRun> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const model = process.env.SOMA_MEAL_MODEL || "sonnet";
  const promptFile = opts.promptFile ?? join(process.cwd(), "lib", "nutrition-agent-prompt.md");
  const mcpConfig = opts.mcpConfig ?? writeMcpConfig(process.cwd());

  const args = [
    "-p", "--output-format", "json", "--model", model,
    "--json-schema", JSON.stringify(MEAL_PROPOSAL_SCHEMA),
    "--append-system-prompt-file", promptFile,
    "--mcp-config", mcpConfig, "--strict-mcp-config",
    "--add-dir", uploadsDir(),
    "--no-session-persistence",
  ];

  const transcript = [
    contextBlock, "", "## The conversation so far", "",
    ...thread.map((m) => `${m.role === "user" ? "Owner" : "You"}: ${m.text}${m.image ? `\n[image: ${m.image}]` : ""}`),
  ].join("\n");

  const started = Date.now();
  return new Promise<AgentRun>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    // The agent's cwd is a scratch directory so it has no repo. The tool server is reached by
    // the absolute path in the generated config, and runs with the repo as ITS cwd.
    const child = spawn(resolveClaudeCmd(), args, {
      cwd: neutralCwd(), env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(() => reject(new Error(`meal agent timed out after ${Math.round(timeoutMs / 1000)}s`)));
    }, timeoutMs);

    let out = ""; let err = "";
    child.stdout.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    child.stderr.on("data", (c: Buffer) => { err += c.toString("utf8"); });
    child.on("error", (e) => done(() => reject(new Error(`failed to spawn claude: ${e.message}`))));
    child.on("close", (code) => done(() => {
      let evt: ResultEnvelope | null = null;
      try { evt = JSON.parse(out.trim()) as ResultEnvelope; } catch { /* handled below */ }
      if (!evt) return reject(new Error(`claude exited ${code} without JSON${err ? `: ${err.trim().slice(0, 200)}` : ""}`));
      if (evt.is_error) return reject(new Error(`claude: ${(evt.result ?? "error").slice(0, 200)}`));
      let raw: unknown = evt.structured_output;
      if (raw == null && typeof evt.result === "string") {
        try { raw = JSON.parse(evt.result); } catch { raw = null; }
      }
      const proposal = parseProposal(raw);
      if (!proposal) {
        return reject(new Error(`meal agent answered outside the schema: ${JSON.stringify(raw).slice(0, 300)}`));
      }
      resolve({ proposal, model, durationMs: Date.now() - started });
    }));

    child.stdin.write(transcript);
    child.stdin.end();
  });
}
