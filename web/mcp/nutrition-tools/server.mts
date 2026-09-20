/**
 * The two tools the meal reader cannot answer from its context block.
 *
 * ⛔ READ-ONLY ON PURPOSE. The agent may look anything up and may change nothing. Every write in
 * this feature goes through soma's own validated code after the proposal comes back.
 *
 * Written as .mts and run with tsx, so it can reuse lib/db and lib/ingredient-research rather
 * than keeping a second copy of the lookup logic that would drift from the first.
 *
 * Web access is NOT here: that is the Tavily MCP servers already configured on this machine.
 * Reading a photo is NOT here either: that is the built-in Read tool, confined by --add-dir.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../../lib/db";
import { searchUsda, searchOpenFoodFacts } from "../../lib/ingredient-research";

const sql = getDb();

const TOOLS = [
  {
    name: "search_food",
    description:
      "Find per-100g macros for a food. Checks the owner's own catalog first, then the USDA " +
      "table, then Open Food Facts. Returns candidates each with a source and a confidence; " +
      "pick one or none. Use this for a food that is not in the context list.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "The food as the owner said it" } },
      required: ["query"],
    },
  },
  {
    name: "my_history",
    description:
      "Every gram amount this owner has logged for one ingredient, when the small, usual and " +
      "large figures in the context block are not enough. Takes an ingredient id from that list.",
    inputSchema: {
      type: "object",
      properties: { ingredient_id: { type: "string" } },
      required: ["ingredient_id"],
    },
  },
];

async function searchFood(query: string) {
  const like = `%${query}%`;
  const slugLike = `%${query.trim().replace(/\s+/g, "_")}%`;
  const own = await sql`
    SELECT id, name, category, calories_per_100g, protein_per_100g, carbs_per_100g,
           fat_per_100g, fiber_per_100g, unit, grams_per_unit
    FROM ingredients
    WHERE status = 'confirmed' AND (name ILIKE ${like} OR id ILIKE ${slugLike})
    LIMIT 5`;
  if (own.length) return { source: "catalog", candidates: own };

  const usda = await searchUsda(sql, query, 5);
  if (usda.length) return { source: "usda", candidates: usda };

  try {
    const off = await searchOpenFoodFacts(query, { limit: 5, timeoutMs: 6000, userAgent: "soma-meal-reader" });
    if (off.length) return { source: "off", candidates: off };
  } catch {
    // The network is not required to answer. Fall through to the honest empty result.
  }

  return {
    source: "none", candidates: [],
    note: "Nothing found. Estimate from a typical recipe, set source to estimate and cap confidence at 0.6.",
  };
}

async function myHistory(ingredientId: string) {
  const rows = await sql`
    SELECT m.date::text AS date, (it->>'grams')::float AS grams
    FROM meal_log m
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(m.items) = 'array' THEN m.items
           WHEN jsonb_typeof(m.items->'items') = 'array' THEN m.items->'items'
           ELSE '[]'::jsonb END) it
    WHERE it->>'ingredient_id' = ${ingredientId}
      AND (it->>'grams') ~ '^[0-9.]+$'
    ORDER BY m.date DESC LIMIT 40`;
  return { ingredient_id: ingredientId, count: rows.length, portions: rows };
}

const server = new Server(
  { name: "nutrition-tools", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result =
      name === "search_food" ? await searchFood(String((args as Record<string, unknown>)?.query ?? "")) :
      name === "my_history" ? await myHistory(String((args as Record<string, unknown>)?.ingredient_id ?? "")) :
      { error: `unknown tool: ${name}` };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(e) }) }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
