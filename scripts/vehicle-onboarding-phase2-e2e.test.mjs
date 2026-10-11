/**
 * Vehicle Onboarding Phase 2 in a real browser: the paperwork step, the
 * fleet-wide readiness chips and filter, and what a save actually says.
 *
 * Each of these has a failure mode that only a browser sees:
 *
 *   The readiness filter travels in the URL, and admin.tsx strips every search
 *   parameter a tab does not own. Forget `ready` in PARAM_OWNER and the chip
 *   lights up, the list reloads unfiltered, and the parameter disappears from
 *   the URL a moment later — the exact shape of the wrong-vehicle inspection
 *   bug this project already paid for once.
 *
 *   The paperwork step must come AFTER the car is saved and must not hold it
 *   hostage: Skip has to leave a vehicle behind.
 *
 *   "Saved" with nothing changed, and "Saved" when a field was refused, are
 *   both lies that a unit test can only see one half of.
 *
 * Server functions are stubbed; the server-side rules they stand for are
 * tested for real against the real modules in
 * scripts/vehicle-onboarding-phase2.test.mjs.
 *
 * Run: npx vite dev --host 127.0.0.1 --port 5199, then npm run test:onboarding2-e2e
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";
const A = "0c2b8f66-0000-4000-8000-00000000000a"; // listing ready
const B = "0c2b8f66-0000-4000-8000-00000000000b"; // rental ready
const C = "0c2b8f66-0000-4000-8000-00000000000c"; // needs setup
const NEW = "0c2b8f66-0000-4000-8000-00000000000e"; // the car Quick Add makes

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "00000000-0000-0000-0000-0000000000aa", role: "authenticated", email: "probe@example.com", exp })}.sig`;
const session = {
  access_token: jwt, token_type: "bearer", expires_in: 86400 * 30, expires_at: exp, refresh_token: "probe-refresh",
  user: { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated", email: "probe@example.com",
    app_metadata: {}, user_metadata: { full_name: "Probe Owner" }, created_at: new Date().toISOString() },
};

const FLEET = [
  { id: A, unit_number: "RR-A", year: 2013, make: "Ford", model: "Fusion", trim: null, color: "Blue",
    license_plate: "AAA111", vin: "1HGCM82633A004352", status: "available", body_type: "sedan",
    weekly_rate: 350, partner_id: null, photo: null, on_rent: false,
    readiness: "listing_ready", readinessGaps: [] },
  { id: B, unit_number: "RR-B", year: 2016, make: "Toyota", model: "Camry", trim: null, color: "Grey",
    license_plate: "BBB222", vin: "1HGCM82633A004353", status: "available", body_type: "sedan",
    weekly_rate: 400, partner_id: null, photo: null, on_rent: false,
    readiness: "rental_ready", readinessGaps: ["Published Listing Photo"] },
  { id: C, unit_number: "RR-C", year: 2019, make: "Honda", model: "Civic", trim: null, color: null,
    license_plate: null, vin: "1HGCM82633A004354", status: "onboarding", body_type: "sedan",
    weekly_rate: null, partner_id: null, photo: null, on_rent: false,
    readiness: "not_ready", readinessGaps: ["Valid VIN", "Weekly Rate"] },
];
const COUNTS = { listing_ready: 1, rental_ready: 1, not_ready: 1 };

let state;
const freshState = () => ({
  car: { color: "Blue", license_plate: "AAA111", plate_state: "FL" },
  saves: [],
  /** Set to make the next section save answer with a refused field. */
  refuse: null,
  created: [],
  docsOpened: 0,
  listCalls: [],
});

const profilePayload = () => ({
  vehicle: {
    id: A, unit_number: "RR-A", year: 2013, make: "Ford", model: "Fusion", trim: null,
    body_type: "sedan", vin: "1HGCM82633A004352", status: "onboarding",
    registration_number: null, registration_state: null, registration_expires_on: null,
    plate_expires_on: null, insurance_carrier: null, insurance_expires_on: null,
    current_odometer: 41000, weekly_rate: 350, monthly_rate: 1400, deposit: 300, seats: 5, doors: 4,
    title_number: null, title_status: null, title_on_file: false, gps_status: null, archived_at: null, notes: null,
    ...state.car,
  },
  title: { documentOnFile: false, metadataRecorded: false },
  finance: null, canSeeFinance: false, canEdit: true,
  unitLabel: "RR-A", vinLast4: "4352", isActive: true, currentRental: null, partnerName: null,
  counts: { documents: 0, sharedDocuments: 0, openMaintenance: 0, inspections: 0, rentals: 0, photos: 0, publishedPhotos: 0 },
  profileContext: { docKinds: [], maintenanceCount: 0, inspectionCount: 0, photoCount: 0,
    title: { documentOnFile: false, metadataRecorded: false } },
  alerts: [], nextService: null, financials: null,
  readinessFacts: { lastPreDeliveryPassedAt: null, schedules: [], openIssues: [], openIncidents: [], hasActiveRental: false },
});

function serverFn(name, input) {
  switch (true) {
    case /listVehicles/.test(name): {
      // The stub honours `ready` so the chip is really filtering something.
      state.listCalls.push(input?.ready ?? "all");
      const rows = (input?.ready && input.ready !== "all")
        ? FLEET.filter((v) => v.readiness === input.ready)
        : FLEET;
      return {
        rows, total: rows.length, page: 1, pageSize: 50,
        statuses: ["available", "onboarding", "archived"], bodyTypes: ["sedan"],
        readinessCounts: COUNTS,
      };
    }
    case /createVehicle/.test(name):
      state.created.push(input);
      return { ok: true, id: NEW, unit_number: "RR-NEW" };
    case /getVehicleProfile/.test(name):
      return profilePayload();
    case /updateVehicleSection/.test(name): {
      state.saves.push({ section: input?.section, intended: input?.intended ?? [] });
      if (state.refuse) { const r = state.refuse; state.refuse = null; return r; }
      const saved = [];
      const unchanged = [];
      for (const k of input?.intended ?? []) {
        const next = input.values?.[k];
        if (String(next ?? "") !== String(state.car[k] ?? "")) { state.car[k] = next; saved.push({ field: k, label: k.replace(/_/g, " ") }); }
        else unchanged.push({ field: k, label: k.replace(/_/g, " ") });
      }
      return { ok: true, saved, unchanged, rejected: [], ignored: [] };
    }
    case /listVehicleDocs/.test(name): state.docsOpened++; return [];
    case /listVehicleLinkedDocs/.test(name): return [];
    case /getVehicleDocAccess/.test(name): return { financeSlots: false };
    case /getVehicleSuggestions/.test(name):
      return { suggestions: [], conflicts: [], possibleMatches: [], needsVerification: [], canOwnership: false };
    case /listVehicleMedia/.test(name):
      return { items: [], canDelete: true, enhancement: { available: false, provider: null, reason: "Off" } };
    case /getPhotoReadingStatus/.test(name):
      return { enabled: false, dailyLimit: 10, usedToday: 0, remainingToday: 10, pausedReason: null, pausedAt: null,
        updatedAt: null, updatedBy: null, refusal: "Photo Reading is switched off.", isOwner: false };
    case /getPhotoEnhanceStatus/.test(name): return { enabled: false, dailyLimit: 20, usedToday: 0, isOwner: false };
    case /getVehicleFinance/.test(name): return null;
    case /suggestUnitNumber/.test(name): return { suggestion: "RR-NEW" };
    case /getVehicleDefaults|listVehicleDefaults|vehicleDefaults/.test(name): return { rows: [], defaults: [] };
    default: return null;
  }
}

const restRows = (url) => {
  if (url.includes("user_roles")) return [{ role: "admin" }];
  if (url.includes("/rest/v1/partners")) return [];
  return [];
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function open(viewport, path) {
  state = freshState();
  const ctx = await browser.newContext({ viewport });
  await ctx.route(`**://${REF}.supabase.co/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    if (url.includes("/storage/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "ok" }) });
    const isHead = route.request().method() === "HEAD";
    return route.fulfill({
      status: 200, contentType: "application/json", headers: { "content-range": "0-1/2" },
      body: isHead ? "" : JSON.stringify(restRows(url)),
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 200)));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  // The list view is remembered per browser; pin it so the table is on screen.
  await page.addInitScript(() => window.localStorage.setItem("rr.vehicles.view", "list"));
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    let name = "";
    try { name = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch { /* not ours */ }
    let input = null;
    try {
      const post = route.request().postData();
      if (post) input = fromCrossJSON(JSON.parse(post).t, { refs: new Map() })?.data ?? null;
    } catch { /* no body */ }
    try {
      return route.fulfill({
        status: 200, contentType: "application/json", headers: { "x-tss-serialized": "true" },
        body: JSON.stringify(toCrossJSON({ result: serverFn(name, input), context: {} }, { refs: new Map() })),
      });
    } catch (e) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: String(e?.message ?? e) }) });
    }
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  return { ctx, page, errors };
}

async function readiness(label, viewport) {
  console.log(`\n================ ${label} — fleet readiness (${viewport.width}x${viewport.height})`);
  const { ctx, page, errors } = await open(viewport, "/admin?tab=vehicles");

  const bar = page.locator('[data-testid="fleet-readiness"]');
  ok(await bar.count() === 1, "the Vehicles list shows fleet readiness");
  const text = await bar.innerText();
  ok(/Listing Ready\s*1/.test(text) && /Rental Ready\s*1/.test(text) && /Needs Setup\s*1/.test(text),
    `all three bands are counted (${text.replace(/\n/g, " ")})`);

  ok(await page.locator('[data-readiness="not_ready"]').count() >= 1, "a Needs Setup car is marked in the list");
  ok(await page.locator('[data-readiness="listing_ready"]').count() >= 1, "  so is a Listing Ready one");
  const gapTitle = await page.locator('[data-readiness="not_ready"]').first().getAttribute("title");
  ok(/Missing:/.test(gapTitle ?? ""), `  and says what is missing (${gapTitle})`);

  // ---- the chip filters, and the URL keeps the parameter
  await bar.locator('[data-band="not_ready"]').first().click();
  await page.waitForTimeout(1600);
  ok(page.url().includes("ready=not_ready"), `the URL carries the filter (${page.url().split("?")[1] ?? ""})`);
  ok(state.listCalls.includes("not_ready"), "the server was asked for that band");
  const rowsNow = await page.locator("tbody tr").count();
  ok(rowsNow === 1, `only the matching car is listed (${rowsNow})`);
  ok(await page.locator('[data-readiness="listing_ready"]').count() === 0, "  and the ready ones are gone");

  // The router strips any parameter a tab does not own. This is that check.
  await page.waitForTimeout(1200);
  ok(page.url().includes("ready=not_ready"), "the parameter survives the router's normalisation");
  ok(await bar.locator('[data-band="not_ready"][aria-pressed="true"]').count() === 1,
    "the chip shows as the active filter");
  ok(/Needs Setup\s*1/.test(await bar.innerText()), "and the chips still count the fleet, not the filtered page");

  await page.getByRole("button", { name: /^Show all$/ }).click();
  await page.waitForTimeout(1500);
  ok(!page.url().includes("ready="), "Show all clears it from the URL");
  ok(await page.locator("tbody tr").count() === 3, "  and the whole fleet is back");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
  ok(errors.length === 0, errors.length ? `no page errors — saw ${errors[0]}` : "no page errors");
  await ctx.close();
}

async function paperwork(label, viewport) {
  console.log(`\n================ ${label} — the optional paperwork step (${viewport.width}x${viewport.height})`);
  const { ctx, page, errors } = await open(viewport, "/admin?tab=vehicles&add=1");

  ok(await page.getByText("Quick Add Vehicle").count() > 0, "Add Vehicle opens");
  await page.getByLabel("Year").or(page.locator("label", { hasText: /^Year/ }).locator("input")).first().fill("2013");
  await page.locator("label", { hasText: /^Make/ }).locator("input").first().fill("Ford");
  await page.locator("label", { hasText: /^Model/ }).locator("input").first().fill("Fusion");
  await page.getByRole("button", { name: /^Save Vehicle$|^Save$/ }).first().click();
  await page.waitForTimeout(1800);

  ok(state.created.length === 1, "the vehicle is created");
  ok(await page.getByText("Add paperwork", { exact: false }).count() > 0,
    "and the dialog offers paperwork instead of closing");
  ok(/is saved/.test(await page.locator("body").innerText()), "  saying the car is already saved");
  ok(state.docsOpened > 0, "  the existing Paperwork panel is what is shown");
  ok(await page.getByRole("button", { name: /Skip For Now/ }).count() === 1, "Skip For Now is offered");

  await page.getByRole("button", { name: /Skip For Now/ }).click();
  await page.waitForTimeout(1500);
  ok(await page.getByText("Add paperwork", { exact: false }).count() === 0, "skipping closes the dialog");
  ok(state.created.length === 1, "  and the car stays created — nothing was rolled back");

  ok(errors.length === 0, errors.length ? `no page errors — saw ${errors[0]}` : "no page errors");
  await ctx.close();
}

async function feedback(label, viewport) {
  console.log(`\n================ ${label} — what a save says (${viewport.width}x${viewport.height})`);
  const { ctx, page, errors } = await open(viewport, `/admin?tab=vehicles&id=${A}`);

  const edit = () => page.locator("section").filter({ has: page.getByText("Vehicle Details", { exact: true }) }).first()
    .getByRole("button", { name: /^Edit$/ }).first();

  // ---- nothing changed is not a save
  await edit().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Save Changes$/ }).first().click();
  await page.waitForTimeout(1400);
  ok(/No changes to save/i.test(await page.locator("body").innerText()), "pressing Save with nothing changed says so");
  ok((state.saves.at(-1)?.intended ?? []).length === 0, "  and nothing was claimed as edited");

  // ---- one field changed is named
  await page.waitForTimeout(600);
  await edit().click();
  await page.waitForTimeout(800);
  await page.locator("label", { hasText: /^Color/ }).locator("input").first().fill("Silver");
  await page.getByRole("button", { name: /^Save Changes$/ }).first().click();
  await page.waitForTimeout(1600);
  ok((state.saves.at(-1)?.intended ?? []).join() === "color", "only the edited field is posted as intended");
  ok(/Saved color/i.test(await page.locator("body").innerText()), "and the save names what it saved");

  // ---- a refused field stays on screen
  state.refuse = {
    ok: true, saved: [{ field: "color", label: "color" }],
    unchanged: [], ignored: [],
    rejected: [{ field: "title_number", label: "title number", reason: "Title details are Owner-only." }],
  };
  await page.waitForTimeout(600);
  await edit().click();
  await page.waitForTimeout(800);
  await page.locator("label", { hasText: /^Color/ }).locator("input").first().fill("Green");
  await page.getByRole("button", { name: /^Save Changes$/ }).first().click();
  await page.waitForTimeout(1600);
  const body = await page.locator("body").innerText();
  ok(/Owner-only/.test(body), "a refused field is reported with its reason");
  ok(/Not saved/.test(body), "  in those words");
  ok(await page.getByText("Edit Details", { exact: true }).count() > 0,
    "  and the drawer stays open rather than claiming a save");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
  ok(errors.length === 0, errors.length ? `no page errors — saw ${errors[0]}` : "no page errors");
  await ctx.close();
}

// ONLY=readiness|paperwork|feedback runs one section. Used when checking that
// a deliberately broken guard turns THIS section red rather than tripping over
// an unrelated one while the dev server is still recompiling.
const only = process.env.ONLY;
const SECTIONS = { readiness, paperwork, feedback };
for (const [label, viewport] of [["DESKTOP", { width: 1440, height: 900 }], ["MOBILE", { width: 390, height: 844 }]]) {
  for (const [name, run] of Object.entries(SECTIONS)) {
    if (only && only !== name) continue;
    await run(label, viewport);
  }
}

await browser.close();
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
