// T3a.6 web verification: research → pick → fill unknown macro → confirm → the picker shows the new ingredient.
// Runs against the Mac's dev server (:3456, serves the working tree, owner's real DB) with the API bearer as an extra header,
// so the demo gate lets the confirm through (same boundary the app uses).
import { chromium } from "@playwright/test";
const base = "http://127.0.0.1:3456", query = process.env.QUERY || "cottage cheese", expected = process.env.EXPECTED || "";
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { Authorization: `Bearer ${process.env.SOMA_TOKEN}` } });
const page = await ctx.newPage(); const log = (m) => console.log(`[web] ${m}`);
try {
  await page.goto(`${base}/nutrition`, { waitUntil: "networkidle", timeout: 60000 }); log(`opened ${page.url()}`);
  // Slot cards are collapsed accordions; open Breakfast first.
  await page.getByText(/^\s*Breakfast\s*$/).first().click(); log("expanded Breakfast");
  await page.getByRole("button", { name: /add meal/i }).first().click({ timeout: 15000 }); log("Add meal");
  const compose = page.getByRole("button", { name: /compose/i }).first(); await compose.waitFor({ timeout: 15000 }); await compose.click(); log("Compose");
  await page.getByTestId("research-row").click(); log("research row");
  await page.getByTestId("research-query").fill(query); await page.getByTestId("research-go").click(); log(`research "${query}"`);
  await page.getByTestId("proposal-0").waitFor({ timeout: 90000 }); const first = (await page.getByTestId("proposal-0").innerText()).split("\n")[0]; log(`proposal-0: ${first}`);
  await page.screenshot({ path: "/tmp/soma/web-verify/proposals.png" });
  await page.getByTestId("proposal-0").click();
  for (const k of ["calories_per_100g","protein_per_100g","carbs_per_100g","fat_per_100g","fiber_per_100g"]) { const f = page.getByTestId(`macro-${k}`); if ((await f.inputValue()).trim() === "") { await f.fill("0"); log(`filled unknown ${k} with 0 (owner's call)`); } }
  await page.screenshot({ path: "/tmp/soma/web-verify/form.png" });
  await page.getByTestId("research-confirm").click(); log("confirm");
  const want = expected || first.replace(/\s*·.*$/, "");
  await page.getByRole("button", { name: want.slice(0, 30) }).first().waitFor({ timeout: 30000 }); log(`picker shows: ${want}`);
  await page.screenshot({ path: "/tmp/soma/web-verify/after.png", fullPage: false });
  console.log(`VERIFIED web: '${want}' in the picker after research → confirm`);
} catch (e) { await page.screenshot({ path: "/tmp/soma/web-verify/fail.png" }).catch(() => {}); console.log(`FAILED web: ${e.message.split("\n")[0]}`); process.exitCode = 1; }
finally { await browser.close(); }
