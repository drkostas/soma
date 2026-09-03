"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Ingredient } from "@/lib/portion-solver";

/* T3a — ingredient research on the web (soma#684, parity with the app's sheet): propose from
 * the local USDA table + Open Food Facts with source and confidence, pick, edit, CONFIRM.
 * An unknown macro is an empty field the owner must fill — never a silent 0. */

export const CATEGORIES = ["protein", "carbs", "grain", "vegetable", "fat", "dairy", "fruit", "sauce", "condiment", "drink", "snack", "dessert", "treat", "supplement", "restaurant"];
const MACROS = [
  ["calories_per_100g", "kcal"], ["protein_per_100g", "protein g"], ["carbs_per_100g", "carbs g"], ["fat_per_100g", "fat g"], ["fiber_per_100g", "fiber g"],
] as const;
type MacroKey = (typeof MACROS)[number][0];

interface Proposal {
  id: number; name: string; brand?: string | null;
  calories_per_100g: number | null; protein_per_100g: number | null; carbs_per_100g: number | null; fat_per_100g: number | null; fiber_per_100g: number | null;
  source: "usda" | "off"; source_id: string; source_url: string; confidence: number; rationale: string; flags: string[];
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
const guessCategory = (name: string): string => {
  const n = name.toLowerCase();
  if (/kefir|yog|milk|cheese|skyr|quark|cottage/.test(n)) return "dairy";
  if (/chicken|beef|pork|turkey|fish|salmon|tuna|egg|tofu|whey|shrimp|lamb/.test(n)) return "protein";
  if (/rice|pasta|bread|oat|potato|quinoa|noodle|tortilla|cereal/.test(n)) return "carbs";
  if (/apple|banana|berry|orange|grape|mango|melon|kiwi|pear|peach/.test(n)) return "fruit";
  if (/oil|butter|nut|almond|peanut|avocado|seed|tahini/.test(n)) return "fat";
  if (/broccoli|spinach|tomato|lettuce|pepper|onion|carrot|cucumber|zucchini|salad|vegetable/.test(n)) return "vegetable";
  return "snack";
};

export function IngredientResearchPanel({ initialQuery, onConfirmed, onClose }: {
  initialQuery: string;
  /** The catalog row after a successful confirm; the parent refreshes its ingredient list. */
  onConfirmed: (ing: Ingredient) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [pick, setPick] = useState<Proposal | null>(null);
  const [name, setName] = useState(""); const [slug, setSlug] = useState(""); const [category, setCategory] = useState("snack");
  const [isRaw, setIsRaw] = useState(false); const [unit, setUnit] = useState("g"); const [gramsPerUnit, setGramsPerUnit] = useState("");
  const [macros, setMacros] = useState<Record<MacroKey, string>>({ calories_per_100g: "", protein_per_100g: "", carbs_per_100g: "", fat_per_100g: "", fiber_per_100g: "" });
  const [existing, setExisting] = useState<{ msg: string; presets: { id: string; name: string }[] } | null>(null);

  async function research() {
    const q = query.trim(); if (q.length < 2) return;
    setBusy(true); setErr(null); setPick(null); setExisting(null);
    try {
      const r = await fetch("/api/nutrition/ingredients/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      const j = (await r.json()) as { error?: string; proposals?: Proposal[]; warnings?: string[] };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setProposals(j.proposals ?? []); setWarnings(j.warnings ?? []);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }
  function choose(p: Proposal) {
    setPick(p); setExisting(null); setErr(null);
    setName(p.brand ? `${p.name} (${p.brand})` : p.name); setSlug(slugify(p.name)); setCategory(guessCategory(p.name)); setIsRaw(false); setUnit("g"); setGramsPerUnit("");
    const m = {} as Record<MacroKey, string>; for (const [k] of MACROS) { const v = p[k]; m[k] = v == null ? "" : String(v); } setMacros(m);
  }
  async function confirm(updateExisting = false) {
    if (!pick) return;
    const nums = {} as Record<MacroKey, number>;
    for (const [k, label] of MACROS) { const v = Number(macros[k]); if (macros[k].trim() === "" || !Number.isFinite(v) || v < 0) { setErr(`${label} is unknown — fill it in (an unknown is not 0)`); return; } nums[k] = v; }
    if (!/^[a-z0-9][a-z0-9_]{1,59}$/.test(slug)) { setErr("id must be a-z, 0-9 and _"); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/nutrition/ingredients/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      proposal_id: pick.id, id: slug, name: name.trim() || pick.name, category, is_raw: isRaw, unit: unit.trim() || "g",
      grams_per_unit: gramsPerUnit.trim() ? Number(gramsPerUnit) : null, ...nums, update_existing: updateExisting,
    }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; ingredient?: Ingredient; error?: string; presets_using?: { id: string; name: string }[] };
    setBusy(false);
    if (r.ok && j.ok && j.ingredient) { onConfirmed(j.ingredient); return; }
    if (r.status === 409) { setExisting({ msg: j.error ?? "exists", presets: j.presets_using ?? [] }); return; }
    setErr(j.error ?? `HTTP ${r.status}`);
  }
  const fmt = (v: number | null) => (v == null ? "?" : String(v));
  const input = "rounded-md border px-2 py-1 text-sm bg-background";

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="research-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Research an ingredient</span>
        <button className="text-xs text-muted-foreground" onClick={onClose}>close</button>
      </div>
      <p className="text-xs text-muted-foreground">Proposals come from USDA (local table) and Open Food Facts with a source and a confidence. Nothing enters your catalog until you confirm it.</p>
      <div className="flex gap-2">
        <input data-testid="research-query" className={`flex-1 ${input}`} placeholder="e.g. kefir" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && research()} />
        <Button size="sm" data-testid="research-go" disabled={busy || query.trim().length < 2} onClick={research}>{busy && !pick ? "…" : "Research"}</Button>
      </div>
      {err ? <div className="text-xs text-red-500">{err}</div> : null}
      {warnings.map((w) => <div key={w} className="text-xs text-amber-500">{w}</div>)}

      {proposals && !pick ? (proposals.length === 0 ? <div className="text-xs text-muted-foreground">No candidates for “{query}”. Try another spelling or the brand name.</div> : (
        <div className="space-y-1.5">
          {proposals.map((p, i) => (
            <button key={p.id} data-testid={`proposal-${i}`} className="w-full rounded-md border p-2 text-left hover:bg-muted" onClick={() => choose(p)}>
              <div className="text-sm">{p.name}{p.brand ? ` · ${p.brand}` : ""}</div>
              <div className="text-xs text-muted-foreground tabular-nums">{fmt(p.calories_per_100g)} kcal · P {fmt(p.protein_per_100g)} · C {fmt(p.carbs_per_100g)} · F {fmt(p.fat_per_100g)} · fib {fmt(p.fiber_per_100g)} /100 g</div>
              <div className="flex items-center justify-between text-xs"><a className="text-primary underline" href={p.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p.source === "usda" ? "USDA" : "Open Food Facts"} · {Math.round(p.confidence * 100)}%</a>{p.flags.length ? <span className="text-amber-500">{p.flags.join(", ")}</span> : null}</div>
            </button>
          ))}
        </div>
      )) : null}

      {pick ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs"><span className="font-medium">Confirm into the catalog</span><button className="text-muted-foreground" onClick={() => setPick(null)}>← candidates</button></div>
          <input data-testid="research-name" className={`w-full ${input}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <input data-testid="research-slug" className={`w-full ${input}`} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="id (slug)" />
          <div className="text-xs text-muted-foreground">Per 100 g — every field must be a number:</div>
          <div className="grid grid-cols-5 gap-1.5">
            {MACROS.map(([k, label]) => (
              <label key={k} className="text-xs text-muted-foreground">{label}
                <input data-testid={`macro-${k}`} className={`w-full ${input} ${macros[k].trim() === "" ? "border-red-500" : ""}`} inputMode="decimal" value={macros[k]} onChange={(e) => setMacros((m) => ({ ...m, [k]: e.target.value }))} placeholder="?" />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => <Button key={c} size="sm" variant={category === c ? "default" : "outline"} className="h-6 text-xs" onClick={() => setCategory(c)}>{c}</Button>)}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={isRaw} onChange={(e) => setIsRaw(e.target.checked)} /> raw (cook it)</label>
            <input className={`w-16 ${input}`} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit" />
            {unit.trim() && unit.trim() !== "g" ? <input className={`w-24 ${input}`} value={gramsPerUnit} onChange={(e) => setGramsPerUnit(e.target.value)} placeholder="g per unit" inputMode="decimal" /> : null}
          </div>
          {existing ? (
            <div className="rounded-md border border-amber-500 p-2 text-xs">
              <div className="text-amber-500">{existing.msg}</div>
              {existing.presets.length ? <div className="text-muted-foreground">Used by presets: {existing.presets.map((p) => p.name).join(", ")}</div> : null}
              <Button size="sm" variant="outline" className="mt-1 h-6 text-xs" onClick={() => confirm(true)}>Overwrite the existing ingredient</Button>
            </div>
          ) : null}
          <Button size="sm" data-testid="research-confirm" className="w-full" disabled={busy} onClick={() => confirm(false)}>{busy ? "Confirming…" : "Confirm ingredient"}</Button>
        </div>
      ) : null}
    </div>
  );
}
