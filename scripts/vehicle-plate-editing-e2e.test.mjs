/**
 * Typing a plate into Edit Details, in a real browser.
 *
 * The report was about a screen, so the test is about a screen: open a
 * vehicle, click Edit on the card that says "Plate: —", and there has to be a
 * box to type the plate into and a dropdown to pick the state from — then the
 * card above has to show what was just saved without a reload.
 *
 * A source-matching test cannot see this. The plate was already editable in
 * the Registration & Title drawer the whole time; what was wrong was which
 * button led where, which is exactly the class of defect the readiness audit
 * found and only a browser caught.
 *
 * The server function is stubbed, so the whitelist, the duplicate check and
 * the Manager gate are NOT what is under test here — they are covered for
 * real against the real module in vehicle-plate-editing.test.mjs. This checks
 * the round trip: what the drawer renders, what it sends, and what the card
 * shows afterwards.
 *
 * Synthetic vehicle, stubbed server functions, no paid call, no real record.
 *
 * Run: npx vite dev --host 127.0.0.1 --port 5199, then npm run test:plate-e2e
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";
const SUBJECT = "0b1a7e55-0000-4000-8000-00000000abcd";

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

let state;
const freshState = () => ({
  /** A car part-way through onboarding: no plate, no registration date. */
  car: { license_plate: null, plate_state: null, plate_expires_on: null, registration_expires_on: null, color: "Blue" },
  saves: [],
  refuse: null,
  profileReads: 0,
});

/** Only the columns each section owns, as the real whitelist does. */
const SECTION_FIELDS = {
  identity: ["license_plate", "plate_state", "color"],
  dmv: ["license_plate", "plate_state", "plate_expires_on", "registration_expires_on"],
};

const READINESS = { lastPreDeliveryPassedAt: null, schedules: [], openIssues: [], openIncidents: [], hasActiveRental: false };

const profilePayload = () => ({
  vehicle: {
    id: SUBJECT, unit_number: "RR-SYN", year: 2013, make: "Ford", model: "Fusion", trim: null,
    body_type: "sedan", vin: "1HGCM82633A004352", status: "onboarding",
    registration_number: null, registration_state: null,
    insurance_carrier: null, insurance_policy_number: null, insurance_effective_on: null, insurance_expires_on: null,
    current_odometer: 41000, weekly_rate: 350, monthly_rate: 1400, deposit: 300, seats: 5, doors: 4,
    title_number: null, title_status: null, title_on_file: false, gps_status: null, archived_at: null, notes: null,
    ...state.car,
  },
  title: { documentOnFile: false, metadataRecorded: false },
  finance: null, canSeeFinance: false, canEdit: true,
  unitLabel: "RR-SYN", vinLast4: "4352", isActive: true, currentRental: null, partnerName: null,
  counts: { documents: 0, sharedDocuments: 0, openMaintenance: 0, inspections: 0, rentals: 0, photos: 0, publishedPhotos: 0 },
  profileContext: { docKinds: [], maintenanceCount: 0, inspectionCount: 0, photoCount: 0,
    title: { documentOnFile: false, metadataRecorded: false } },
  alerts: [], nextService: null, financials: null, readinessFacts: READINESS,
});

function serverFn(name, input) {
  switch (true) {
    case /getVehicleProfile/.test(name):
      state.profileReads++;
      return profilePayload();
    case /updateVehicleSection/.test(name): {
      state.saves.push({ section: input?.section, values: input?.values ?? {} });
      if (state.refuse) { const r = state.refuse; state.refuse = null; return r; }
      for (const k of SECTION_FIELDS[input?.section] ?? []) {
        if (k in (input?.values ?? {})) {
          const v = input.values[k];
          state.car[k] = typeof v === "string" ? (v.trim().toUpperCase() || null) : (v ?? null);
        }
      }
      if (typeof state.car.color === "string") state.car.color = state.car.color.replace(/^(.)(.*)$/, (_, a, b) => a + b.toLowerCase());
      return { ok: true };
    }
    case /getVehicleSuggestions/.test(name):
      return { suggestions: [], conflicts: [], possibleMatches: [], needsVerification: [], canOwnership: false };
    case /listVehicleMedia/.test(name):
      return { items: [], canDelete: true, enhancement: { available: false, provider: null, reason: "Off" } };
    case /getPhotoReadingStatus/.test(name):
      return { enabled: false, dailyLimit: 10, usedToday: 0, remainingToday: 10, pausedReason: null, pausedAt: null,
        updatedAt: null, updatedBy: null, refusal: "Photo Reading is switched off.", isOwner: false };
    case /getPhotoEnhanceStatus/.test(name): return { enabled: false, dailyLimit: 20, usedToday: 0, isOwner: false };
    case /getVehicleDocAccess/.test(name): return { financeSlots: false };
    case /listVehicleDocs/.test(name): return [];
    case /listVehicleLinkedDocs/.test(name): return [];
    case /getVehicleFinance/.test(name): return null;
    case /listVehicles/.test(name): return { rows: [], total: 0, page: 1, pageSize: 25 };
    default: return null;
  }
}

const restRows = (url) => (url.includes("user_roles") ? [{ role: "admin" }] : []);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function open(viewport) {
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
  await page.goto(`${BASE}/admin?tab=vehicles&id=${SUBJECT}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  return { ctx, page, errors };
}

/** The Edit button belonging to one named card, not whichever is first. */
const cardEdit = (page, title) =>
  page.locator("section").filter({ has: page.getByText(title, { exact: true }) }).first()
    .getByRole("button", { name: /^Edit$/ }).first();

async function run(label, viewport) {
  console.log(`\n================ ${label} (${viewport.width}x${viewport.height})`);
  const { ctx, page, errors } = await open(viewport);

  const detailsCard = page.locator("section").filter({ has: page.getByText("Vehicle Details", { exact: true }) }).first();
  ok(await detailsCard.count() === 1, "the Vehicle Details card renders");
  ok(/Plate\s*\n?\s*—/.test(await detailsCard.innerText()), "  and reports the plate as not recorded");

  // --------------------------------------------- the complaint, exactly
  await cardEdit(page, "Vehicle Details").click();
  await page.waitForTimeout(900);
  ok(await page.getByText("Edit Details", { exact: true }).count() > 0, "its Edit button opens Edit Details");

  const plate = page.getByLabel("License Plate").or(page.locator("label", { hasText: /^License Plate/ }).locator("input")).first();
  ok(await plate.count() > 0, "  which now HAS a License Plate box — the field that was missing");

  const stateSelect = page.locator("label", { hasText: /^Plate State/ }).locator("select").first();
  ok(await stateSelect.count() > 0, "  and a Plate State dropdown");
  const opts = await stateSelect.locator("option").allInnerTexts();
  ok(opts.length === 52, `    offering a blank and 51 states (got ${opts.length})`);
  ok(opts.some((o) => /^FL/.test(o)) && opts.some((o) => /^GA/.test(o)), "    including the ones a Tampa car wears");
  ok(opts[0].trim() === "—", "    with unknown still available as an answer");

  // ------------------------------------------------- saving, and the card
  await plate.fill("abc1234");
  await stateSelect.selectOption("FL");
  await page.getByRole("button", { name: /^Save Changes$/ }).first().click();
  await page.waitForTimeout(1600);

  const sent = state.saves.at(-1);
  ok(sent?.section === "identity", "Save posts the identity section, through the one update function");
  ok(sent?.values?.license_plate === "abc1234" && sent?.values?.plate_state === "FL",
    "  carrying the plate and the state as typed and chosen");
  ok(state.profileReads >= 2, "  then re-reads the vehicle");
  const after = await page.locator("section").filter({ has: page.getByText("Vehicle Details", { exact: true }) }).first().innerText();
  ok(/FL ABC1234/.test(after), `  and the card shows the saved plate straight away (${(after.match(/Plate[\s\S]{0,16}/) ?? [""])[0].replace(/\n/g, " ")})`);
  ok(await page.getByText("Edit Details", { exact: true }).count() === 0, "  and the drawer has closed");

  // ------------------------------------------- a refusal lands on the field
  state.refuse = { ok: false, field: "license_plate", error: "RR-SYN2 already has that plate." };
  await cardEdit(page, "Vehicle Details").click();
  await page.waitForTimeout(800);
  const plate2 = page.locator("label", { hasText: /^License Plate/ }).locator("input").first();
  await plate2.fill("DUP1234");
  await page.getByRole("button", { name: /^Save Changes$/ }).first().click();
  await page.waitForTimeout(1200);
  ok(await page.getByText("already has that plate").count() > 0, "a duplicate is reported where it was typed");
  ok(await page.getByText("Edit Details", { exact: true }).count() > 0, "  and the drawer stays open with the work in it");
  ok(await plate2.inputValue() === "DUP1234", "  without discarding what was typed");

  // ------------------------------- the registration expiry is one click away
  const toDmv = page.locator('[data-testid="identity-open-dmv"]');
  ok(await toDmv.count() === 1, "Edit Details links to the registration paperwork");
  await toDmv.click();
  await page.waitForTimeout(900);
  ok(await page.getByText("Edit Registration & Title", { exact: true }).count() > 0, "  which opens that drawer");
  const expiry = page.locator("label", { hasText: /^Registration Expires/ }).locator("input").first();
  ok(await expiry.count() === 1, "  where Registration Expiration can be typed by hand");
  await expiry.fill("2029-06-30");
  await page.getByRole("button", { name: /^Save Changes$/ }).first().click();
  await page.waitForTimeout(1600);
  ok(state.saves.at(-1)?.section === "dmv" && state.saves.at(-1)?.values?.registration_expires_on === "2029-06-30",
    "  and saving it posts the DMV section");
  ok(state.car.registration_expires_on === "2029-06-30", "  so the date is recorded");

  // the plate must have survived the hand-over, not been wiped by a stale form
  ok(state.car.license_plate === "ABC1234", "the plate saved earlier is untouched by the second drawer");

  const dmvState = page.locator("label", { hasText: /^Plate State/ }).locator("select");
  ok(await dmvState.count() === 0 || (await dmvState.locator("option").count()) === 52,
    "the DMV drawer's Plate State is the same dropdown");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
  ok(errors.length === 0, errors.length ? `no page errors — saw ${errors[0]}` : "no page errors");
  await ctx.close();
}

await run("DESKTOP", { width: 1440, height: 900 });
await run("MOBILE", { width: 390, height: 844 });

await browser.close();
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
