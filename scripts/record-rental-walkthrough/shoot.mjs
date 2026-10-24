// Captures the walkthrough screenshots from the local harness (synthetic fixtures only).
import { createServer } from "vite";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const out = fileURLToPath(new URL("../../docs/record-rental/walkthrough/", import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: fileURLToPath(new URL("./vite.config.mjs", import.meta.url)), logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const shots = [];
async function scenario(s, steps, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:5199/?s=${s}`);
  await page.getByRole("navigation", { name: "Record Rental Steps" }).waitFor();
  await page.waitForTimeout(400);
  for (const [name, act] of steps) {
    if (act) await act(page);
    await page.waitForTimeout(300);
    const file = `${s}-${name}.png`;
    await page.screenshot({ path: out + file, fullPage: true });
    shots.push(file);
  }
  if (errors.length) throw new Error(`${s}: ${errors.join("; ")}`);
  await page.close();
}
const step = title => p => p.getByRole("navigation", { name: "Record Rental Steps" }).getByRole("button", { name: new RegExp("^" + title) }).click();
const field = (p, label) => p.locator("label", { hasText: label }).locator("input,select,textarea").first();
await scenario("blocked", [["1-driver", null], ["2-licence", step("Licence")], ["3-agreement", step("Signed Agreement")], ["6-review", step("Review")]]);
await scenario("esign", [
  ["1-driver", p => field(p, "Vehicle").selectOption({ index: 1 })],
  ["2-licence-check", async p => { await step("Licence")(p); await p.getByRole("button", { name: "Run Licence Check" }).click(); }],
  ["2-licence-confirmed", p => p.getByRole("button", { name: "Confirm Licence Verified" }).click()],
  ["3-agreement", step("Signed Agreement")],
  ["4-details", async p => { await step("Rental Details")(p); await field(p, "Verified Pickup Time").fill("2026-10-01T09:30:00-04:00");
    await field(p, "Pickup Mileage").fill("41250"); await field(p, "Weekly Rate").fill("350"); await field(p, "Deposit Collected").fill("500");
    await field(p, "Reason For Recording").fill("Rental began before the system tracked it; recording from the signed eSign agreement."); }],
  ["5-billing", async p => { await step("Billing")(p); await p.getByRole("button", { name: "Check Existing Stripe Link" }).click(); await p.waitForTimeout(300); await p.getByRole("checkbox").check(); }],
  ["6-review", async p => { await step("Review")(p); await field(p, "Type RECORD RENTAL").fill("RECORD RENTAL"); }],
]);
await scenario("historical", [["3-agreement", step("Signed Agreement")], ["3-void-reason", p => p.getByRole("button", { name: "Void Historical Agreement" }).click()]]);
await scenario("historical", [["4-details", step("Rental Details")]]);
await scenario("legacy", [["3-agreement", async p => { await field(p, "Vehicle").selectOption({ index: 1 }); await step("Signed Agreement")(p); }]]);
await scenario("esign", [["mobile-1-driver", null]], 390);
await browser.close(); await server.close();
console.log(shots.join("\n"));
