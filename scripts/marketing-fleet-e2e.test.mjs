/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   THE PUBLIC MARKETING FLEET MUST NOT DEPEND ON CURRENT OPERATIONAL
 *   AVAILABILITY.
 *
 * The homepage used to render whatever `vehicles_public` returned for
 * `status = 'available'`. With the operational table empty that is an empty
 * grid, so every paid click landed on nothing. Reading the JSX cannot tell you
 * whether that is still true. This drives a real browser against a real build
 * with the inventory API faked, so each scenario is judged on what a visitor
 * would actually see.
 *
 * Run: npm run dev, then npm run test:fleet-e2e
 * (separate from `npm test` for the same reason test:nav is — it needs a
 * server; the static half of this rule is scripts/marketing-fleet.test.mjs.)
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = process.env.FLEET_E2E_BASE ?? "http://127.0.0.1:5199";
const SUPABASE_REST = "**/rest/v1/**";

let fail = 0;
const ok = (c, l) => {
  if (!c) fail++;
  console.log(`    ${c ? "ok  " : "FAIL"} ${l}`);
};

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const unit = (n, body, status, rate = 350) => ({
  id: uuid(n), year: 2019, make: "Toyota", model: `Model${n}`, body_type: body,
  status, weekly_rate: rate, monthly_rate: rate * 4, seats: body === "xl" ? 7 : 5,
  doors: 4, fuel_type: "gas", miles_per_tank: 350, photos: [], uber_eligibility: [],
});

/** Fakes PostgREST well enough to honour the filters these pages send. */
function restRoute(scenario) {
  return async (route) => {
    if (scenario.mode === "abort") return route.abort("connectionfailed");
    if (scenario.mode === "error")
      return route.fulfill({
        status: 500, contentType: "application/json",
        body: JSON.stringify({ message: "simulated backend failure" }),
      });
    const u = new URL(route.request().url());
    let rows = scenario.rows;
    const st = u.searchParams.get("status");
    if (st?.startsWith("eq.")) rows = rows.filter((r) => r.status === st.slice(3));
    if (st?.startsWith("neq.")) rows = rows.filter((r) => r.status !== st.slice(4));
    const bt = u.searchParams.get("body_type");
    if (bt?.startsWith("eq.")) rows = rows.filter((r) => r.body_type === bt.slice(3));
    return route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(rows),
    });
  };
}

const SCENARIOS = [
  ["zero inventory", { mode: "rows", rows: [] }],
  ["inventory query errors", { mode: "error" }],
  ["inventory query never answers", { mode: "abort" }],
  ["100% utilization — 10 cars, all rented", {
    mode: "rows",
    rows: Array.from({ length: 10 }, (_, i) => unit(i + 1, ["sedan", "suv", "xl"][i % 3], "rented")),
  }],
  ["partial — 1 sedan and 1 XL free, 0 SUV", {
    mode: "rows",
    rows: [unit(1, "sedan", "available"), unit(2, "suv", "rented"),
           unit(3, "xl", "available", 450), unit(4, "sedan", "rented")],
  }],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
});

async function fresh(scenario, viewport = { width: 1280, height: 1200 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await page.route(SUPABASE_REST, restRoute(scenario));
  page.errors = errors;
  return page;
}

for (const [name, scenario] of SCENARIOS) {
  const partial = name.startsWith("partial");
  console.log(`\n── ${name}`);
  const page = await fresh(scenario);

  console.log("  homepage");
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const cards = await page.locator("a.car-card").count();
  const hrefs = await page.locator("a.car-card").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  const text = await page.locator("body").innerText();
  const avail = (text.match(/Available now:[^\n]*/) || [null])[0];

  // THE RULE.
  ok(cards === 3, `three catalog cards render regardless of inventory (got ${cards})`);
  ok(["sedan", "suv", "xl"].every((c) => hrefs.includes(`/fleet?type=${c}`)),
     "Sedan, SUV and Minivan are all represented");
  ok(/Vehicles Built For Gig Work\./.test(text), "heading: Vehicles Built For Gig Work.");
  ok(!/Vehicles Available Now\./.test(text), "the old availability claim is gone");
  ok(/Browse the types of vehicles we regularly offer\. Availability changes daily\./.test(text),
     "copy says these are types, and that availability moves");
  ok(hrefs.every((h) => /^\/fleet\?type=(sedan|suv|xl)$/.test(h ?? "")),
     "no catalog card routes to /fleet/<uuid>");

  // Availability is a claim, so it is made only where inventory proves it,
  // per category, and never inferred from the catalog's own existence.
  if (partial) {
    ok(avail === "Available now: Sedans · Minivans",
       `names exactly the categories with a free unit (got ${JSON.stringify(avail)})`);
    ok(!/SUVs/.test(avail ?? ""), "the category with none free stays neutral, not 'none left'");
  } else {
    ok(avail === null, `no availability claim without proven stock (got ${JSON.stringify(avail)})`);
  }
  ok(page.errors.length === 0, `no page errors :: ${JSON.stringify(page.errors)}`);

  console.log("  /fleet");
  page.errors.length = 0;
  await page.goto(BASE + "/fleet", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const fText = await page.locator("body").innerText();
  const fCards = await page.locator("a.car-card").count();
  const fHrefs = await page.locator("a.car-card").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  ok(fCards > 0, `the fleet page is never empty (got ${fCards})`);
  if (partial) {
    ok(/Showing 2 Available Vehicles/.test(fText), "the live count counts only genuinely available units");
    ok(fHrefs.filter((h) => /^\/fleet\/00000000/.test(h ?? "")).length === 2,
       "real units link to their real id");
  } else {
    ok(/Showing 0 Available Vehicles/.test(fText), "the live count is honest at zero");
    ok(fHrefs.every((h) => /^\/apply\?vehicle_type=(sedan|suv|xl)$/.test(h ?? "")),
       "catalog cards there go to apply, not in a circle back to /fleet");
  }
  ok(page.errors.length === 0, `no page errors :: ${JSON.stringify(page.errors)}`);
  await page.close();
}

/* ------------------------------------------------- structured data ------- */
console.log("\n── schema.org availability follows real status");
for (const status of ["available", "rented", "maintenance", "retired"]) {
  const page = await fresh({ mode: "rows", rows: [unit(1, "sedan", status, 375)] });
  await page.goto(BASE + "/fleet", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const box = page.locator('input[type="checkbox"]').first();
  if (await box.isChecked().catch(() => false)) {
    await box.uncheck();
    await page.waitForTimeout(1200);
  }
  const card = page.locator(`a.car-card[href="/fleet/${uuid(1)}"]`);
  const reachable = (await card.count()) > 0;
  if (reachable) {
    await card.first().click();
    await page.waitForTimeout(2500);
  }
  const product = (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map((t) => { try { return JSON.parse(t); } catch { return null; } })
    .find((o) => o && o["@type"] === "Product");
  const availability = product?.offers?.availability ?? null;
  if (status === "available") {
    ok(availability === "https://schema.org/InStock", "available → InStock");
  } else if (status === "retired") {
    ok(!reachable && !product, "retired → not found, no Product emitted at all");
  } else {
    ok(reachable && !!product && availability === null,
       `${status} → price published, availability omitted rather than falsified`);
  }
  await page.close();
}

/* ------------------------------------------- catalog intent → application  */
console.log("\n── a catalog card's category reaches the application");
{
  const page = await fresh({ mode: "rows", rows: [] });
  let sent = null;
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    let fn = "";
    try { fn = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch { /* not ours */ }
    if (!/savePartialApplication/.test(fn)) return route.continue();
    sent = route.request().postData() ?? "";
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ id: null, token: "t".repeat(40), existing: false }),
    });
  });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  // Selected by the category it links to, not by position. The catalog is
  // meant to change size — it already went from six cards to three — and an
  // index silently starts testing a different card when it does.
  await page
    .locator('a.car-card[href="/fleet?type=suv"]')
    .first()
    .locator("button:has-text('Check Availability')")
    .click();
  await page.waitForTimeout(3000);
  ok(/\/apply\?vehicle_type=suv$/.test(page.url()),
     `the CTA carries a category, never a vehicle id (${page.url()})`);

  const visible = page.locator('input:not([type="checkbox"]):not(.hidden)');
  const n = await visible.count();
  for (let i = 0; i < n; i++) {
    const type = (await visible.nth(i).getAttribute("type")) ?? "text";
    await visible.nth(i).fill(type === "email" ? "e2e@example.com" : i === 0 ? "E2E Person" : "8135550147");
  }
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: /continue/i }).last().click();
  await page.waitForTimeout(3000);
  // The body is seroval cross-JSON; the field names are enough to judge it.
  ok(/"vehicle_size"/.test(sent ?? "") && /"SUV"/.test(sent ?? ""),
     "the chosen category is written to the application as vehicle_size");
  ok(!/"vehicle_id"/.test(sent ?? ""),
     "no vehicle_id — a catalog card reserves no physical car");
  ok(!/"vehicle_type"/.test(sent ?? ""),
     "the raw marketing param is not written to the record");
  await page.close();
}

/* --------------------------------------------------- mobile, 375px ------- */
console.log("\n── phone width, with and without images");
for (const imagesWork of [true, false]) {
  const page = await fresh({ mode: "rows", rows: [] }, { width: 375, height: 800 });
  if (!imagesWork) await page.route("**/__l5e/**", (r) => r.abort());
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.locator("h2:has-text('Vehicles Built For Gig Work.')").scrollIntoViewIfNeeded();
  // Lazy images only load once scrolled past, so walk the whole grid.
  for (const handle of await page.locator("a.car-card").elementHandles()) {
    await handle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  const scrolled = await page.evaluate(() => {
    window.scrollTo(9999, window.scrollY);
    const x = window.scrollX;
    window.scrollTo(0, window.scrollY);
    return x;
  });
  const boxes = await page.locator("a.car-card").evaluateAll((els) =>
    els.map((el) => {
      const img = el.querySelector('[class*="aspect-"]').getBoundingClientRect();
      const title = el.querySelector(".text-lg.font-semibold").getBoundingClientRect();
      const price = el.querySelector(".car-price, .leading-snug").getBoundingClientRect();
      const btn = el.querySelector("button").getBoundingClientRect();
      return {
        w: Math.round(el.getBoundingClientRect().width),
        imgH: Math.round(img.height),
        btnH: Math.round(btn.height),
        overlaps: price.left < title.right - 0.5 && price.right > title.left + 0.5 &&
                  price.top < title.bottom - 0.5 && price.bottom > title.top + 0.5,
      };
    }),
  );
  const label = imagesWork ? "images load" : "every image fails";
  ok(scrolled === 0, `${label}: no horizontal overflow (scrolled ${scrolled}px)`);
  ok(boxes.length === 3, `${label}: three cards`);
  ok(boxes.every((b) => !b.overlaps), `${label}: pricing never overlaps the title`);
  ok(boxes.every((b) => b.btnH >= 44), `${label}: CTA is a 44px target (min ${Math.min(...boxes.map((b) => b.btnH))})`);
  ok(new Set(boxes.map((b) => b.imgH)).size === 1,
     `${label}: image area keeps one height, so a failure shifts nothing (${[...new Set(boxes.map((b) => b.imgH))].join()})`);
  ok(boxes.every((b) => b.w <= 359), `${label}: cards stay inside the gutter`);
  const imgs = await page.locator("a.car-card img").count();
  const tiles = await page.locator("a.car-card span.text-sm.font-medium").count();
  ok(imgs + tiles === 3, `${label}: every card shows a photo or a labelled tile (${imgs} + ${tiles})`);
  if (imagesWork) {
    const alts = await page.locator("a.car-card img").evaluateAll((e) => e.map((x) => x.getAttribute("alt")));
    ok(alts.every((a) => ["Sedan", "SUV", "Minivan"].includes(a ?? "")),
       "alt text names the vehicle type and nothing more specific");
  }
  await page.close();
}

await browser.close();
console.log(`\n${fail === 0 ? "PASS" : `FAIL — ${fail} assertion(s)`}`);
process.exit(fail === 0 ? 0 : 1);
