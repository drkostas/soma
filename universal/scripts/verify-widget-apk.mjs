#!/usr/bin/env node
/**
 * The widget lives in plugins/soma-widget and only reaches android/ when `expo prebuild` runs.
 * Gradle will happily compile a stale copy and exit 0, so the only honest check is to read the
 * built APK. Every marker below is something the widget layouts and the provider put there.
 *
 * Usage: node scripts/verify-widget-apk.mjs [path/to/app-release.apk]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const DEFAULT_APK = "android/app/build/outputs/apk/release/app-release.apk";
const apk = process.argv[2] ?? DEFAULT_APK;

/** What the widget must have put into the APK, and where it comes from. */
const MARKERS = [
  { needle: "say_what_you_ate", from: "the capture button's view id, in both nutrition layouts" },
  { needle: "Say what you ate", from: "the capture button's label" },
  { needle: "universal://nutrition", from: "the deep link the button fires" },
  { needle: "openCapture", from: "the provider method that builds the PendingIntent" },
];

if (!existsSync(apk)) {
  console.error(`no APK at ${apk}. Build one with: npx expo prebuild --platform android && (cd android && ./gradlew assembleRelease)`);
  process.exit(2);
}

// unzip -p streams a member to stdout; the resource table and the dex files carry every marker.
const entries = execFileSync("unzip", ["-Z1", apk], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\n")
  .filter((n) => n.endsWith(".arsc") || n.endsWith(".dex") || n.startsWith("res/"));

const hits = new Map(MARKERS.map((m) => [m.needle, 0]));
for (const name of entries) {
  let buf;
  try {
    buf = execFileSync("unzip", ["-p", apk, name], { maxBuffer: 1 << 28 });
  } catch {
    continue;
  }
  for (const { needle } of MARKERS) if (buf.includes(needle)) hits.set(needle, hits.get(needle) + 1);
}

let bad = 0;
for (const { needle, from } of MARKERS) {
  const n = hits.get(needle);
  if (!n) bad++;
  console.log(`${n ? "ok  " : "MISSING"} ${needle.padEnd(24)} ${n} entries   ${from}`);
}

if (bad) {
  console.error(`\n${bad} widget marker(s) missing from ${apk}. Run \`npx expo prebuild --platform android\` and build again.`);
  process.exit(1);
}
console.log(`\nall ${MARKERS.length} widget markers present in ${apk}`);
