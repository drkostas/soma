// https://docs.expo.dev/guides/using-eslint/
// Baseline (T6, 2026-09-11): the rules that flagged existing screens are warnings until each is
// fixed on its own. CI fails on any error and on the warning count growing past the baseline.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

const baseline = {
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/immutability": "warn",
  "react-hooks/exhaustive-deps": "warn",
  "react-hooks/static-components": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/refs": "warn",
  "react/display-name": "warn",
  "react/no-unescaped-entities": "warn",
  "@typescript-eslint/no-unused-vars": "warn",
  "@typescript-eslint/array-type": "warn",
  "import/no-duplicates": "warn",
};

// A rule may only be tuned inside a config object that registers its plugin, so the overrides
// are merged into the Expo objects that own them instead of appended as a new object.
const tuned = (Array.isArray(expoConfig) ? expoConfig : [expoConfig]).map((o) => {
  if (!o.plugins) return o;
  const rules = { ...(o.rules ?? {}) };
  for (const [rule, level] of Object.entries(baseline)) {
    const prefix = rule.slice(0, rule.lastIndexOf("/"));
    if (prefix in o.plugins) rules[rule] = level;
  }
  return { ...o, rules };
});

module.exports = defineConfig([...tuned, { ignores: ["dist/*", "android/*", ".expo/*"] }]);
