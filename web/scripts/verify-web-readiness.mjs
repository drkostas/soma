// #647 web verification: the training page renders readiness "unknown" (grey "?" card, no stale forced-RED banner,
// a "No sleep data for <date>" note) against the working-tree server with the API bearer. Prints what it saw.
import { chromium } from "@playwright/test";
const base = process.env.BASE || "http://127.0.0.1:3457";
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { Authorization: `Bearer ${process.env.SOMA_TOKEN}` } });
const page = await ctx.newPage();
try {
  await page.goto(`${base}/training`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/soma/verify/web-training-647.png", fullPage: false });
  const body = await page.locator("body").innerText();
  const pick = (re) => { const m = body.match(re); return m ? m[0] : "(not found)"; };
  console.log("readiness card:", pick(/Today.s Readiness[\s\S]{0,160}/));
  console.log("no_sleep banner:", pick(/No sleep data for [^\n]{0,120}/));
  console.log("forced RED present:", /forced RED/.test(body));
  console.log("recommendation:", pick(/Readiness unknown[^\n]{0,120}/));
} catch (e) { console.log("FAILED:", e.message.split("\n")[0]); process.exitCode = 1; }
finally { await browser.close(); }
