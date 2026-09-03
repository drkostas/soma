import { useState } from "react";
import { View, ScrollView, TextInput, Pressable, ActivityIndicator, Linking } from "react-native";
import { Text, Button, Modal } from "soma-style";
import { researchIngredient, confirmIngredient, type IngredientProposal, type Ingredient } from "../lib/api";

/* T3a — ingredient research (soma#678): the owner types a food, soma proposes candidates from
 * the local USDA table and Open Food Facts with source + confidence, the owner picks one, edits,
 * and CONFIRMS. Nothing enters the catalog without that confirm; an unknown macro is an empty
 * field the owner must fill, never a silent 0. */

export const CATEGORIES = ["protein", "carbs", "grain", "vegetable", "fat", "dairy", "fruit", "sauce", "condiment", "drink", "snack", "dessert", "treat", "supplement", "restaurant"];
const MACROS = [
  ["calories_per_100g", "kcal"], ["protein_per_100g", "protein g"], ["carbs_per_100g", "carbs g"], ["fat_per_100g", "fat g"], ["fiber_per_100g", "fiber g"],
] as const;
type MacroKey = (typeof MACROS)[number][0];

function slugify(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}
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

function SourceBadge({ p }: { p: IngredientProposal }) {
  const label = p.source === "usda" ? "USDA" : "Open Food Facts";
  return (
    <Pressable onPress={() => Linking.openURL(p.source_url)} hitSlop={6}>
      <Text variant="micro" className="text-teal">{label} · {Math.round(p.confidence * 100)}% ↗</Text>
    </Pressable>
  );
}

export function IngredientResearchSheet({ visible, initialQuery, onClose, onConfirmed }: {
  visible: boolean; initialQuery: string; onClose: () => void;
  /** Called with the catalog row after a successful confirm; the parent refetches presets. */
  onConfirmed: (ing: Ingredient) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [proposals, setProposals] = useState<IngredientProposal[] | null>(null);
  const [pick, setPick] = useState<IngredientProposal | null>(null);
  // the editable confirm form
  const [name, setName] = useState(""); const [slug, setSlug] = useState(""); const [category, setCategory] = useState("snack");
  const [isRaw, setIsRaw] = useState(false); const [unit, setUnit] = useState("g"); const [gramsPerUnit, setGramsPerUnit] = useState("");
  const [macros, setMacros] = useState<Record<MacroKey, string>>({ calories_per_100g: "", protein_per_100g: "", carbs_per_100g: "", fat_per_100g: "", fiber_per_100g: "" });
  const [existing, setExisting] = useState<{ name: string; presets: { id: string; name: string }[] } | null>(null);

  async function research() {
    const q = query.trim(); if (q.length < 2) return;
    setBusy(true); setErr(null); setPick(null); setExisting(null);
    try { const r = await researchIngredient(q); setProposals(r.proposals); setWarnings(r.warnings); }
    catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }
  function choose(p: IngredientProposal) {
    setPick(p); setExisting(null); setErr(null);
    const nm = p.brand ? `${p.name} (${p.brand})` : p.name;
    setName(nm); setSlug(slugify(p.name)); setCategory(guessCategory(p.name)); setIsRaw(false); setUnit("g"); setGramsPerUnit("");
    const m = {} as Record<MacroKey, string>;
    for (const [k] of MACROS) { const v = p[k]; m[k] = v == null ? "" : String(v); }
    setMacros(m);
  }
  async function confirm(updateExisting = false) {
    if (!pick) return;
    const nums = {} as Record<MacroKey, number>;
    for (const [k, label] of MACROS) {
      const v = Number(macros[k]); if (macros[k].trim() === "" || !Number.isFinite(v) || v < 0) { setErr(`${label} is unknown — fill it in (an unknown is not 0)`); return; }
      nums[k] = v;
    }
    if (!/^[a-z0-9][a-z0-9_]{1,59}$/.test(slug)) { setErr("id must be a-z, 0-9 and _"); return; }
    setBusy(true); setErr(null);
    const r = await confirmIngredient({
      proposal_id: pick.id, id: slug, name: name.trim() || pick.name, category, is_raw: isRaw, unit: unit.trim() || "g",
      grams_per_unit: gramsPerUnit.trim() ? Number(gramsPerUnit) : null, ...nums, update_existing: updateExisting,
    });
    setBusy(false);
    if (r.ok && r.ingredient) { onConfirmed(r.ingredient); reset(); onClose(); return; }
    if (r.status === 409) { setExisting({ name: r.error ?? "exists", presets: r.presets_using ?? [] }); return; }
    setErr(r.error ?? `HTTP ${r.status}`);
  }
  function reset() { setProposals(null); setPick(null); setErr(null); setWarnings([]); setExisting(null); }

  const fmt = (v: number | null) => (v == null ? "?" : String(v));
  return (
    <Modal visible={visible} onClose={() => { reset(); onClose(); }} title="Research an ingredient">
      <ScrollView keyboardShouldPersistTaps="handled" className="max-h-[80vh]">
        <Text variant="micro" className="mb-2 text-text-muted">Proposals come from USDA (local table) and Open Food Facts with a source and a confidence. Nothing enters your catalog until you confirm it.</Text>
        <View className="flex-row gap-2">
          <TextInput testID="research-query" placeholder="e.g. kefir" placeholderTextColor="#5a7a8a" value={query} onChangeText={setQuery} onSubmitEditing={research} autoCapitalize="none"
            className="flex-1 rounded-md border border-border-subtle px-3 py-2 text-text" />
          <Pressable testID="research-go" onPress={research} disabled={busy || query.trim().length < 2}><Button label={busy && !pick ? "…" : "Research"} variant="primary" size="sm" disabled={busy || query.trim().length < 2} onPress={research} /></Pressable>
        </View>
        {err ? <Text variant="micro" className="mt-2 text-danger">{err}</Text> : null}
        {warnings.map((w) => <Text key={w} variant="micro" className="mt-1 text-warm">{w}</Text>)}
        {busy && !proposals ? <ActivityIndicator className="mt-3" /> : null}

        {proposals && !pick ? (
          proposals.length === 0 ? <Text variant="caption" className="mt-3 text-text-muted">No candidates for “{query}”. Try another spelling or the brand name.</Text> : (
            <View className="mt-3 gap-2">
              {proposals.map((p, i) => (
                <Pressable key={p.id} testID={`proposal-${i}`} onPress={() => choose(p)} className="rounded-md border border-border-subtle p-2">
                  <Text variant="caption" className="text-text" numberOfLines={2}>{p.name}{p.brand ? ` · ${p.brand}` : ""}</Text>
                  <Text variant="micro" className="text-text-muted tabular-nums">{fmt(p.calories_per_100g)} kcal · P {fmt(p.protein_per_100g)} · C {fmt(p.carbs_per_100g)} · F {fmt(p.fat_per_100g)} · fib {fmt(p.fiber_per_100g)} /100 g</Text>
                  <View className="flex-row items-center justify-between"><SourceBadge p={p} />{p.flags.length ? <Text variant="micro" className="text-warm">{p.flags.join(", ")}</Text> : null}</View>
                </Pressable>
              ))}
            </View>
          )
        ) : null}

        {pick ? (
          <View className="mt-3 gap-2">
            <View className="flex-row items-center justify-between"><Text variant="caption" className="text-teal">Confirm into the catalog</Text><Pressable onPress={() => setPick(null)} hitSlop={8}><Text variant="micro" className="text-text-muted">← candidates</Text></Pressable></View>
            <SourceBadge p={pick} />
            <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor="#5a7a8a" className="rounded-md border border-border-subtle px-3 py-2 text-text" />
            <TextInput value={slug} onChangeText={(t) => setSlug(t.toLowerCase())} placeholder="id (slug)" placeholderTextColor="#5a7a8a" autoCapitalize="none" className="rounded-md border border-border-subtle px-3 py-2 text-text" />
            <Text variant="micro" className="text-text-muted">Per 100 g — every field must be a number:</Text>
            <View className="flex-row flex-wrap gap-2">
              {MACROS.map(([k, label]) => (
                <View key={k} className="w-[30%]">
                  <Text variant="micro" className="text-text-muted">{label}</Text>
                  <TextInput testID={`macro-${k}`} value={macros[k]} onChangeText={(t) => setMacros((m) => ({ ...m, [k]: t }))} keyboardType="decimal-pad" placeholder="?" placeholderTextColor="#c0603a"
                    className={`rounded-md border px-2 py-1 text-text ${macros[k].trim() === "" ? "border-danger" : "border-border-subtle"}`} />
                </View>
              ))}
            </View>
            <Text variant="micro" className="text-text-muted">Category</Text>
            <View className="flex-row flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <Pressable key={c} onPress={() => setCategory(c)} className={`rounded-full border px-2 py-1 ${category === c ? "border-teal bg-teal-dim" : "border-border-subtle"}`}>
                  <Text variant="micro" className={category === c ? "text-teal" : "text-text-muted"}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <View className="flex-row items-center gap-3">
              <Pressable onPress={() => setIsRaw((v) => !v)} className={`rounded-full border px-2 py-1 ${isRaw ? "border-teal bg-teal-dim" : "border-border-subtle"}`}><Text variant="micro" className={isRaw ? "text-teal" : "text-text-muted"}>{isRaw ? "✓ raw (cook it)" : "raw? (cook it)"}</Text></Pressable>
              <TextInput value={unit} onChangeText={setUnit} placeholder="unit (g)" placeholderTextColor="#5a7a8a" className="w-20 rounded-md border border-border-subtle px-2 py-1 text-text" />
              {unit.trim() && unit.trim() !== "g" ? <TextInput value={gramsPerUnit} onChangeText={setGramsPerUnit} keyboardType="decimal-pad" placeholder="g per unit" placeholderTextColor="#5a7a8a" className="w-24 rounded-md border border-border-subtle px-2 py-1 text-text" /> : null}
            </View>
            {existing ? (
              <View className="rounded-md border border-warm p-2">
                <Text variant="micro" className="text-warm">{existing.name}</Text>
                {existing.presets.length ? <Text variant="micro" className="text-text-muted">Used by presets: {existing.presets.map((p) => p.name).join(", ")}</Text> : null}
                <Button label="Overwrite the existing ingredient" variant="ghost" size="sm" onPress={() => confirm(true)} />
              </View>
            ) : null}
            <Pressable testID="research-confirm" onPress={() => confirm(false)} disabled={busy}><Button label={busy ? "Confirming…" : "Confirm ingredient"} variant="primary" disabled={busy} onPress={() => confirm(false)} /></Pressable>
          </View>
        ) : null}
      </ScrollView>
    </Modal>
  );
}
