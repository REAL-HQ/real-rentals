/**
 * The readiness card and the inspection it sends you to, in a real browser.
 *
 * The bug this exists for cannot be seen in a unit test: the Fix button
 * navigated to the Inspections tab with no vehicle, and the Start Inspection
 * form defaulted to whichever car sorted first. Clicking Fix on the SECOND
 * vehicle opened a pre-delivery inspection pointed at the FIRST. So the
 * fixture deliberately puts the vehicle under test second in the list —
 * if the id is ever dropped again, the form falls back to the other car and
 * this goes red.
 *
 * Also checks what the audit found on RR-009 — a title scan on file while the
 * DMV tab said "Not On File" — and that the extracted details waiting in
 * review are offered from the readiness card instead of being typed by hand.
 *
 * Synthetic vehicles, stubbed server functions, no paid call, no real record.
 *
 * Run: npm run dev, then npm run test:readiness-e2e
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";

/** Deliberately NOT first in the vehicle list. */
const SUBJECT = "061cb5e9-0000-4000-8000-00000000bbbb";
const OTHER = "061cb5e9-0000-4000-8000-00000000aaaa";
const TEMPLATE = "061cb5e9-0000-4000-8000-00000000cccc";

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
  /** Four details waiting in review, as a registration card would produce. */
  pending: [
    ["license_plate", "Plate", "SYN404", false],
    ["plate_state", "Plate state", "FL", false],
    ["registration_number", "Registration number", "SYN-000-01", true],
    ["registration_expires_on", "Registration expiry", "2029-06-30", true],
  ],
  applied: [],
  startedInspections: [],
  profileReads: 0,
});

const READINESS = { lastPreDeliveryPassedAt: null, schedules: [], openIssues: [], openIncidents: [], hasActiveRental: false };

/** A vehicle in exactly the shape the audit found on RR-009: title scan
 *  linked, no title metadata recorded, no registration date. */
const profilePayload = () => ({
  vehicle: {
    id: SUBJECT, unit_number: "RR-SUBJECT", year: 2013, make: "Ford", model: "Fusion", trim: null,
    color: "Blue", body_type: "sedan", vin: "1HGCM82633A004352", status: "onboarding",
    license_plate: null, plate_state: null, plate_expires_on: null,
    registration_number: null, registration_state: null, registration_expires_on: null,
    insurance_carrier: "Synthetic Mutual", insurance_policy_number: "SYN-1",
    insurance_effective_on: "2026-01-01", insurance_expires_on: "2030-01-01",
    current_odometer: null, weekly_rate: 350, monthly_rate: 1400, deposit: 300, seats: 5, doors: 4,
    title_number: null, title_status: null, title_on_file: false, gps_status: null, archived_at: null, notes: null,
  },
  title: { documentOnFile: true, metadataRecorded: false },
  finance: null, canSeeFinance: false, canEdit: true,
  unitLabel: "RR-SUBJECT", vinLast4: "4352", isActive: true, currentRental: null, partnerName: null,
  counts: { documents: 1, sharedDocuments: 0, openMaintenance: 0, inspections: 0, rentals: 0, photos: 0, publishedPhotos: 0 },
  profileContext: { docKinds: ["title", "insurance_card"], maintenanceCount: 0, inspectionCount: 0, photoCount: 0,
    title: { documentOnFile: true, metadataRecorded: false } },
  alerts: [], nextService: null, financials: null, readinessFacts: READINESS,
});

function suggestionsFor() {
  const out = state.pending
    .filter(([f]) => !state.applied.includes(f))
    .map(([field, label, proposed, safe]) => ({
      proposalId: "prop-1", batchId: "batch-1", documentId: "doc-1", fileName: "synthetic-registration.jpg",
      docClass: "registration", page: null, photoPath: null, fromPhoto: false,
      field, label, current: null, proposed, confidence: "high", safe, risk: "normal", kind: "fill",
      evidence: { raw: proposed, note: null },
    }));
  return { suggestions: out, conflicts: [], possibleMatches: [], needsVerification: [], canOwnership: false };
}

function serverFn(name, input) {
  switch (true) {
    case /getVehicleProfile/.test(name):
      state.profileReads++;
      return profilePayload();
    case /getVehicleSuggestions/.test(name):
      return suggestionsFor();
    case /applyImportDecisions/.test(name): {
      const results = (input?.decisions ?? []).map((d) => {
        for (const f of d.acceptFields ?? []) state.applied.push(f);
        return { proposalId: d.proposalId, ok: true, vehicleId: SUBJECT, message: `${(d.acceptFields ?? []).length} change(s) applied.` };
      });
      return { results };
    }
    case /startInspection/.test(name): {
      state.startedInspections.push(input?.vehicleId);
      return { id: "insp-1" };
    }
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

/** InspectionsPanel reads PostgREST directly, not through server functions. */
function restRows(url) {
  if (url.includes("/rest/v1/inspections")) return [];
  if (url.includes("/rest/v1/inspection_templates"))
    return [{ id: TEMPLATE, name: "Pre-Delivery", inspection_type: "pre_delivery", is_active: true }];
  if (url.includes("/rest/v1/vehicles"))
    // The subject is SECOND on purpose: a dropped id falls back to the first.
    return [
      { id: OTHER, year: 2015, make: "Ford", model: "Fusion", license_plate: "AAA111" },
      { id: SUBJECT, year: 2013, make: "Ford", model: "Fusion", license_plate: null },
    ];
  if (url.includes("user_roles")) return [{ role: "admin" }];
  return [];
}

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

async function run(label, viewport) {
  console.log(`\n================ ${label} (${viewport.width}x${viewport.height})`);
  const { ctx, page, errors } = await open(viewport);

  // ------------------------------------------- the checklist is legible
  ok(await page.getByText("Vehicle Readiness").first().isVisible(), "the Readiness card renders");
  const opGroup = page.locator('[data-category="operational"]');
  const compGroup = page.locator('[data-category="compliance"]');
  ok(await opGroup.count() === 1, "the checklist has an Operational group");
  ok(await compGroup.count() === 1, "  and a Compliance group");
  ok(await page.locator('[data-check="inspection"][data-status="not_ready"]').count() === 1,
    "no pre-delivery inspection is still blocking");
  ok(await page.locator('[data-check="registration"][data-status="not_ready"]').count() === 1,
    "a registration with no date is still blocking");
  ok(await page.locator('[data-check="insurance"][data-status="ready"]').count() === 1,
    "control: the insurance that IS in date reads ready, so the two above are real");
  ok(await page.locator('[data-testid="readiness-overall"]').innerText().then((t) => /Not Ready/.test(t)),
    "the overall verdict is unchanged by the grouping");

  // ------------------------------------------- the title, as on RR-009
  await page.getByRole("button", { name: /^Registration$|^DMV$|^Registration & Title$/i }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  const body = await page.locator("body").innerText();
  ok(/Title Document[\s\S]{0,40}On File/.test(body), "the title scan on file is reported as on file");
  ok(/Title Details[\s\S]{0,40}Not Recorded/.test(body), "  and the absent title record is reported separately");
  ok(!/Title Number/.test(body), "  the number stays Owner-only and is not shown to this viewer");

  // ------------------------------------- details waiting, offered not applied
  await page.getByRole("button", { name: /^Overview$/i }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  const banner = page.locator('[data-testid="readiness-pending-details"]');
  ok(await banner.count() === 1, "the Readiness card offers the details waiting in review");
  ok(/4 Details Ready to Review/.test(await banner.innerText()), "  and says how many");
  ok(state.applied.length === 0, "  nothing has been applied merely by showing them");

  await banner.click();
  await page.waitForTimeout(900);
  ok(await page.getByText("Details Found In Documents").count() > 0, "clicking opens the existing review");
  const plateRow = page.locator("label", { hasText: "Plate" }).first();
  ok(await plateRow.count() > 0, "  the plate is listed");
  ok(await page.getByText("Confirm Individually").first().isVisible(),
    "  and the high-risk fields still need an individual tick");
  const safeBtn = page.getByRole("button", { name: /^Approve Safe Fields \(\d+\)$/ });
  ok(/\(2\)/.test(await safeBtn.innerText()), "  only the two safe fields are bulk-approvable");
  ok(state.applied.length === 0, "  still nothing applied without a click");
  // Close by the dialog's own button. Clicking a page corner lands on the
  // admin sidebar and navigates away, which is its own trap.
  await page.getByRole("button", { name: "Close" }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  ok(await page.getByText("Details Found In Documents").count() === 0, "  and closes again");

  // ------------------------------- the inspection opens on the RIGHT vehicle
  await page.waitForTimeout(500);
  const fix = page.locator('[data-check="inspection"]').getByRole("button", { name: /Open Inspections/i });
  ok(await fix.count() === 1, "the inspection check offers a Fix");
  await fix.click();
  await page.waitForTimeout(2200);
  ok(page.url().includes("tab=inspections"), "it navigates to Inspections");
  ok(page.url().includes(SUBJECT), `  carrying the vehicle id (${page.url().split("?")[1] ?? ""})`);
  ok(await page.getByRole("heading", { name: "Start Inspection" }).count() > 0,
    "  and opens Start Inspection without a second click");
  const picked = await page.locator("select").first().inputValue();
  ok(picked === SUBJECT, `  with THIS vehicle selected, not the first in the list (${picked.slice(0, 8)})`);

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
