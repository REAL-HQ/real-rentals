/**
 * THE WORKFLOW THIS FILE EXISTS FOR:
 *
 *   Vehicle Profile → Photos → Read Photos For Vehicle Details →
 *   Choose Photos → Read → Review → Select Fields → Accept Selected
 *
 * Driven in a real browser, at a desktop and a phone, against a faked
 * pipeline. Reading the JSX cannot tell you whether a checkbox appears on the
 * right tiles, whether the thumbnail resolves, whether the profile actually
 * reloads after an accept, or whether a phone gets a horizontal scrollbar.
 *
 * Everything is synthetic: generated JPEGs, a vehicle that exists in no
 * fleet, a stubbed reader. No paid call is made, no real photo is touched,
 * and every server function is intercepted before it leaves the page.
 *
 * What this suite can and cannot police: the server-side rules (a photo never
 * yields a registration expiry, never outranks paperwork, never counts as
 * safe) are enforced in code this harness replaces with a stub, so they are
 * proven in scripts/vehicle-photo-analysis.test.mjs instead. What IS proven
 * here is everything the browser owns — selection, progress, the preview, the
 * per-field ticks, the refresh, and the Owner's switch reaching the button.
 *
 * Run: npm run dev, then npm run test:photo-read-e2e
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";
const VEHICLE_ID = "061cb5e9-0000-4000-8000-00000000c0de";

/** The reader finishes this long after a photo is queued. */
const READ_MS = 2600;

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

// ---------------------------------------------------------------- fake session
const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
  sub: "00000000-0000-0000-0000-0000000000aa", role: "authenticated", email: "probe@example.com", exp,
})}.sig`;
const session = {
  access_token: jwt, token_type: "bearer", expires_in: 86400 * 30, expires_at: exp,
  refresh_token: "probe-refresh",
  user: { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated",
    email: "probe@example.com", app_metadata: {}, user_metadata: { full_name: "Probe Owner" },
    created_at: new Date().toISOString() },
};

/**
 * Synthetic photographs, encoded by the browser itself at the start of the run.
 *
 * An earlier draft pasted a base64 "1x1 JPEG" constant that had no valid frame
 * header: Chromium accepted the blob, reported complete, and decoded nothing —
 * so the assertion that the evidence thumbnail renders was passing on an image
 * that was never there. These are drawn on a canvas and encoded as real JPEGs,
 * one per photograph, so a decode failure means a decode failure.
 */
const PHOTOS = new Map();
async function generatePhotos(browser, paths) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("about:blank");
  for (const [i, path] of paths.entries()) {
    const dataUrl = await page.evaluate(({ i }) => {
      const c = document.createElement("canvas");
      c.width = 240; c.height = 180;
      const g = c.getContext("2d");
      g.fillStyle = ["#1f3a93", "#7f8c8d", "#2c3e50", "#8e44ad"][i % 4];
      g.fillRect(0, 0, 240, 180);
      g.fillStyle = "#ffffff";
      g.font = "bold 28px sans-serif";
      g.fillText("SYN404", 40, 100);
      return c.toDataURL("image/jpeg", 0.8);
    }, { i });
    PHOTOS.set(path, Buffer.from(dataUrl.split(",")[1], "base64"));
  }
  await ctx.close();
}

const SYNTH = { plate: "SYN404", plateState: "FL", color: "Blue", bodyType: "sedan" };

function freshState() {
  return {
    reading: { enabled: true, dailyLimit: 10, usedToday: 0 },
    media: [
      { id: "m-1", kind: "original", file_name: "front.jpg", path: `${VEHICLE_ID}/front.jpg`, is_primary: true },
      { id: "m-2", kind: "original", file_name: "rear-plate.jpg", path: `${VEHICLE_ID}/rear-plate.jpg`, is_primary: false },
      { id: "m-3", kind: "original", file_name: "dash.jpg", path: `${VEHICLE_ID}/dash.jpg`, is_primary: false },
      { id: "m-4", kind: "ai_enhanced", file_name: "front-retouched.jpg", path: `${VEHICLE_ID}/front-r.jpg`, is_primary: false, derived_from_id: "m-1" },
    ],
    batches: new Map(),
    readsByMedia: new Map(),   // mediaId -> itemId (duplicate protection)
    failMedia: new Set(),      // these report a read failure
    applied: [],               // "<proposalId>:<field>"
    profileReads: 0,
    nextId: 1,
  };
}
let state = freshState();

const FIELD_ROWS = [
  ["license_plate", "Plate", SYNTH.plate],
  ["plate_state", "Plate state", SYNTH.plateState],
  ["color", "Color", SYNTH.color],
  ["body_type", "Body type", SYNTH.bodyType],
];

const appliedField = (f) => state.applied.some((a) => a.endsWith(`:${f}`));

function itemView(it) {
  const age = Date.now() - it.at;
  const status = it.failed ? (age < READ_MS ? "analyzing" : "failed") : age < 400 ? "uploaded" : age < READ_MS ? "analyzing" : "ready";
  return {
    id: it.id, document_id: it.documentId, duplicate_of_document_id: null,
    file_name: it.fileName, mime_type: "image/jpeg", size_bytes: 2048, status,
    doc_class: status === "ready" || status === "failed" ? "condition_photo" : null,
    class_confidence: status === "ready" ? "high" : null, classified_manually: false,
    warnings: [], error: status === "failed" ? "That photo was too blurred to read." : null,
    attempts: 1, extraction: status === "ready" ? { shared: {}, vehicleCount: 1 } : null,
    created_at: new Date(it.at).toISOString(), job: null,
  };
}

/** getVehicleSuggestions — mirrors the real server for photo evidence:
 *  nothing is safe, every row names its photograph. */
function suggestionsFor() {
  const out = [];
  for (const b of state.batches.values()) {
    for (const it of b.items) {
      if (itemView(it).status !== "ready") continue;
      for (const [field, label, proposed] of FIELD_ROWS) {
        if (state.applied.includes(`prop-${it.id}:${field}`)) continue;
        out.push({
          proposalId: `prop-${it.id}`, batchId: b.id, documentId: it.documentId,
          fileName: it.fileName, docClass: "condition_photo", page: null,
          photoPath: it.photoPath, fromPhoto: true,
          field, label, current: null, proposed, confidence: "high",
          safe: false, risk: "normal", kind: "fill",
          evidence: { raw: proposed, note: null },
        });
      }
    }
  }
  return { suggestions: out, conflicts: [], possibleMatches: [], needsVerification: [], canOwnership: true };
}

const READINESS = { lastPreDeliveryPassedAt: null, schedules: [], openIssues: [], openIncidents: [], hasActiveRental: false };
const profilePayload = () => ({
  vehicle: {
    id: VEHICLE_ID, unit_number: "RR-SYN", year: 2013, make: "Ford", model: "Fusion",
    trim: null, color: appliedField("color") ? SYNTH.color : null,
    body_type: appliedField("body_type") ? SYNTH.bodyType : null,
    vin: "1SYNTH00000000009", status: "onboarding",
    license_plate: appliedField("license_plate") ? SYNTH.plate : null,
    plate_state: appliedField("plate_state") ? SYNTH.plateState : null,
    registration_number: null, registration_state: null, registration_expires_on: null,
    insurance_carrier: null, insurance_policy_number: null, insurance_effective_on: null,
    insurance_expires_on: null, current_odometer: null, weekly_rate: 350, monthly_rate: 1400,
    deposit: 300, seats: 5, doors: 4, title_number: null, title_status: null, archived_at: null, notes: null,
  },
  finance: null, canSeeFinance: true, canEdit: true,
  unitLabel: "RR-SYN", vinLast4: "0009", isActive: true, currentRental: null, partnerName: null,
  counts: { documents: 0, sharedDocuments: 0, openMaintenance: 0, inspections: 0, rentals: 0, photos: 4, publishedPhotos: 0 },
  profileContext: { docKinds: [], maintenanceCount: 0, inspectionCount: 0, photoCount: 4 },
  alerts: [], nextService: null, financials: null, readinessFacts: READINESS,
});

function serverFn(name, input) {
  switch (true) {
    case /getPhotoReadingStatus/.test(name): {
      const r = state.reading;
      const remaining = Math.max(0, r.dailyLimit - r.usedToday);
      return {
        enabled: r.enabled, dailyLimit: r.dailyLimit, usedToday: r.usedToday, remainingToday: remaining,
        pausedReason: null, pausedAt: null, updatedAt: new Date().toISOString(), updatedBy: "owner-1",
        refusal: !r.enabled
          ? "Photo Reading is switched off. An Owner can turn it on in Settings → Photo Reading."
          : remaining <= 0 ? `Today's limit of ${r.dailyLimit} photos has been reached. It resets at midnight UTC.` : null,
        isOwner: true,
      };
    }
    case /listVehicleMedia/.test(name):
      return {
        items: state.media.map((m, i) => ({
          id: m.id, vehicle_id: VEHICLE_ID, kind: m.kind, provenance: m.kind === "original" ? "uploaded" : "ai_enhanced",
          storage_bucket: "vehicle-photos", storage_path: m.path, file_name: m.file_name,
          mime_type: "image/jpeg", size_bytes: 2048, derived_from_id: m.derived_from_id ?? null,
          enhancement_mode: null, enhancement_provider: null, is_primary: m.is_primary,
          published: false, sort_order: i, caption: null, created_at: new Date().toISOString(),
          review_status: m.kind === "ai_enhanced" ? "pending" : null, quality_flags: null, processing_ms: null,
        })),
        canDelete: true,
        enhancement: { available: false, provider: null, reason: "Off" },
      };
    case /createImportBatch/.test(name): {
      const id = `batch-${state.nextId++}`;
      state.batches.set(id, { id, items: [] });
      return { id };
    }
    case /readVehiclePhoto/.test(name): {
      const mediaId = input?.mediaId;
      const m = state.media.find((x) => x.id === mediaId);
      if (!m) return { ok: false, mediaId, error: "That photo no longer exists." };
      if (m.kind !== "original") return { ok: false, mediaId, error: "Only original photographs can be read — an enhanced copy is not evidence." };
      if (state.readsByMedia.has(mediaId)) return { ok: true, mediaId, itemId: state.readsByMedia.get(mediaId), duplicate: true };
      const remaining = state.reading.dailyLimit - state.reading.usedToday;
      if (!state.reading.enabled) return { ok: false, mediaId, error: "Photo Reading is switched off. An Owner can turn it on in Settings → Photo Reading." };
      if (remaining <= 0) return { ok: false, mediaId, error: `Today's limit of ${state.reading.dailyLimit} photos has been reached. It resets at midnight UTC.` };
      state.reading.usedToday += 1;
      const b = state.batches.get(input?.batchId);
      const n = state.nextId++;
      const it = { id: `item-${n}`, documentId: `doc-${n}`, fileName: m.file_name, photoPath: m.path,
        at: Date.now(), failed: state.failMedia.has(mediaId) };
      if (b) b.items.push(it);
      state.readsByMedia.set(mediaId, it.id);
      return { ok: true, mediaId, itemId: it.id, duplicate: false, remainingToday: state.reading.dailyLimit - state.reading.usedToday };
    }
    case /getImportBatch/.test(name): {
      const b = state.batches.get(input?.batchId);
      if (!b) throw new Error("Not found");
      return {
        batch: { id: b.id, label: "Vehicle Photos", status: "processing", created_at: new Date().toISOString(), source_channel: "vehicle_photo" },
        items: b.items.map(itemView), proposals: [], transactions: [], finance: [],
        vehicles: [], canFinance: true, email: null, queue: { pausedReason: null, pausedAt: null },
      };
    }
    case /getVehicleSuggestions/.test(name):
      return suggestionsFor();
    case /applyImportDecisions/.test(name): {
      const results = (input?.decisions ?? []).map((d) => {
        for (const f of d.acceptFields ?? []) state.applied.push(`${d.proposalId}:${f}`);
        return { proposalId: d.proposalId, ok: true, vehicleId: VEHICLE_ID, message: `${(d.acceptFields ?? []).length} change(s) applied.` };
      });
      return { results };
    }
    case /getVehicleProfile/.test(name):
      state.profileReads++;
      return profilePayload();
    case /getPhotoEnhanceStatus/.test(name):
      return { enabled: false, dailyLimit: 20, usedToday: 0, isOwner: true };
    case /getVehicleDocAccess/.test(name): return { financeSlots: true };
    case /listVehicleDocs/.test(name): return [];
    case /listVehicleLinkedDocs/.test(name): return [];
    case /getVehicleFinance/.test(name): return null;
    case /listVehicles/.test(name): return { rows: [], total: 0, page: 1, pageSize: 25 };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- harness
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function openPhotosTab(viewport, patch) {
  state = freshState();
  // Applied before the page loads, so the first render already reflects it.
  if (patch) patch(state);
  const ctx = await browser.newContext({ viewport });
  await ctx.route(`**://${REF}.supabase.co/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    // A staff photo download: real JPEG bytes, so loadStaffPhoto resolves and
    // the evidence thumbnail actually renders.
    if (url.includes("/storage/v1/object/") && route.request().method() === "GET") {
      const key = decodeURIComponent(url.split("/storage/v1/object/")[1].replace(/^vehicle-photos\//, "").split("?")[0]);
      const bytes = PHOTOS.get(key);
      if (!bytes) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: bytes });
    }
    if (url.includes("/storage/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "ok" }) });
    const isHead = route.request().method() === "HEAD";
    return route.fulfill({
      status: 200, contentType: "application/json", headers: { "content-range": "0-0/0" },
      body: isHead ? "" : JSON.stringify(url.includes("user_roles") ? [{ role: "admin" }] : []),
    });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 300)));
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
      const result = serverFn(name, input);
      if (process.env.TRACE) console.log(`    [fn] ${name.slice(-50)} out=${JSON.stringify(result)?.slice(0, 70)}`);
      return route.fulfill({
        status: 200, contentType: "application/json", headers: { "x-tss-serialized": "true" },
        body: JSON.stringify(toCrossJSON({ result, context: {} }, { refs: new Map() })),
      });
    } catch (e) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: String(e?.message ?? e) }) });
    }
  });

  await page.goto(`${BASE}/admin?tab=vehicles&id=${VEHICLE_ID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  // Into Photos.
  const photosTab = page.getByRole("button", { name: /^Photos$/i }).first();
  if (await photosTab.count()) await photosTab.click();
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

const readBar = (page) => page.locator("text=Read Photos For Vehicle Details").locator("xpath=ancestor::div[1]");

async function runViewport(label, viewport) {
  console.log(`\n================ ${label} (${viewport.width}x${viewport.height})`);
  const { ctx, page, errors } = await openPhotosTab(viewport);

  // ---------------------------------------------------- the tab and the bar
  const bar = page.getByText("Read Photos For Vehicle Details").first();
  ok(await bar.isVisible(), "the Photos tab offers Read Photos For Vehicle Details");
  ok(await page.getByText(/10 of 10 reads left today/).count() > 0,
    "  and says how much of today's allowance is left");

  // ------------------------------------------------- nothing read on arrival
  ok(state.batches.size === 0 && state.reading.usedToday === 0,
    "arriving on the tab reads nothing and spends nothing");

  // ----------------------------------------------------------- choosing
  await page.getByRole("button", { name: "Choose Photos" }).click();
  await page.waitForTimeout(400);
  const boxes = page.locator('input[type="checkbox"][aria-label^="Read "]');
  const n = await boxes.count();
  ok(n === 3, `three original photographs can be chosen, the retouched copy cannot (saw ${n})`);

  const readBtn = page.getByRole("button", { name: /^Read \d+ Photos?$/ });
  ok(await readBtn.isDisabled(), "the Read button is dead until something is chosen");

  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.waitForTimeout(250);
  ok(await page.getByRole("button", { name: "Read 2 Photos" }).count() > 0, "the button counts the chosen photos");

  // ------------------------------------------------------------- reading
  state.failMedia.add("m-2"); // the second one will not read — the error path
  await page.getByRole("button", { name: "Read 2 Photos" }).click();
  await page.waitForTimeout(900);
  ok(await page.getByText(/Reading…/).count() > 0, "the button reports that it is working");
  ok(await page.getByText(/front\.jpg — (sending|reading)/).count() > 0, "per-photo progress is shown while it runs");

  await page.waitForTimeout(READ_MS + 3500);
  ok(state.reading.usedToday === 2, "two reads were spent against the daily allowance");
  ok(await page.getByText(/rear-plate\.jpg: That photo was too blurred to read\./).count() > 0,
    "a photo that could not be read says so, by name");

  // ------------------------------------------------------------- the review
  ok(await page.getByText("Details Found In Documents").count() > 0, "the review panel opens with what was read");
  const plateRow = page.locator("label", { hasText: "Plate" }).first();
  ok(await plateRow.count() > 0, "the plate it read is offered");
  ok(await page.getByText("Read From A Photo").first().isVisible(), "each row says the value came from a photograph");
  ok(await page.getByText("Confirm Individually").first().isVisible(), "and that it needs an individual tick");

  const panel = page.locator('[aria-label="Details Found In Documents"]').first();
  const safeBtn = page.getByRole("button", { name: /^Approve Safe Fields \(\d+\)$/ });
  const safeLabel = (await safeBtn.count()) ? await safeBtn.innerText() : "";
  ok(/\(0\)/.test(safeLabel), `nothing read from a photo is bulk-approvable — button reads "${safeLabel.trim()}"`);
  ok(!(await safeBtn.count()) || await safeBtn.isDisabled(), "  so Approve Safe Fields is dead");

  // --------------------------------------------------- the source photograph
  const thumb = page.locator('button[aria-label="View the photograph this was read from"]').first();
  ok(await thumb.count() > 0, "every row shows the photograph it was read from");
  // The bytes arrive through an async staff download and become a blob URL, so
  // the <img> is in the DOM before it has decoded. Wait for the decode itself.
  let rendered = false;
  for (let i = 0; i < 20 && !rendered; i++) {
    rendered = await thumb.locator("img")
      .evaluate((im) => im.complete && im.naturalWidth > 0).catch(() => false);
    if (!rendered) await page.waitForTimeout(250);
  }
  ok(rendered === true, "  and the image actually loads from private storage");
  await thumb.click();
  await page.waitForTimeout(500);
  const viewer = page.locator('img[alt="Source photograph"]');
  ok(await viewer.count() > 0, "  clicking it opens the photograph full size");
  // Dismiss by the overlay's own handler. Clicking a page corner instead hits
  // the admin sidebar, which navigates away and takes the review panel with it.
  await page.locator('div.fixed.inset-0.z-\\[90\\]').first().click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(400);
  ok(await viewer.count() === 0, "  and closes again without leaving the review");

  // ------------------------------------- nothing has changed on the vehicle
  ok(!appliedField("license_plate"), "nothing has been written to the vehicle yet");
  const currentLine = await panel.getByText(/Current:\s*Not Set/).count();
  ok(currentLine > 0, "  and the rows still say the current value is Not Set");

  // ------------------------------------------------- accepting two of them
  const before = state.profileReads;
  const rowBoxes = panel.locator('label input[type="checkbox"]');
  await rowBoxes.nth(0).check();
  await rowBoxes.nth(1).check();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /^Accept Selected \(2\)$/ }).click();
  await page.waitForTimeout(2200);
  ok(await page.getByText(/Saved 2 Details\./).count() > 0, "accepting reports exactly what was saved");
  ok(state.applied.length === 2, "  and two fields were applied");
  ok(state.profileReads > before, "  the Vehicle Profile reloaded, so Readiness and the plate refresh");

  // ------------------------------------------- reopening the pending ones
  const remainingFields = FIELD_ROWS.length - 2;
  ok((await page.locator('input[type="checkbox"]').count()) > 0, "the still-pending details stay on screen");
  const tabs = page.getByRole("button", { name: /^Details$/i }).first();
  if (await tabs.count()) { await tabs.click(); await page.waitForTimeout(600); }
  const photosTab = page.getByRole("button", { name: /^Photos$/i }).first();
  if (await photosTab.count()) { await photosTab.click(); await page.waitForTimeout(1500); }
  ok(suggestionsFor().suggestions.length === remainingFields * 1,
    `the ${remainingFields} unaccepted details are still pending after leaving and returning`);

  // ------------------------------------------------- duplicate protection
  const spentBefore = state.reading.usedToday;
  await page.getByRole("button", { name: "Choose Photos" }).click();
  await page.waitForTimeout(400);
  const boxes2 = page.locator('input[type="checkbox"][aria-label^="Read "]');
  await boxes2.nth(0).check(); // front.jpg again
  await page.getByRole("button", { name: "Read 1 Photo" }).click();
  await page.waitForTimeout(2500);
  ok(state.reading.usedToday === spentBefore, "reading the same photograph again spends nothing");
  ok(await page.getByText(/front\.jpg — already read/).count() > 0, "  and the tab says it was already read");

  // --------------------------------------------------------- phone layout
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal overflow at this width (overflow ${overflow}px)`);

  ok(errors.length === 0, errors.length ? `no page errors — saw: ${errors[0]}` : "no page errors");
  await ctx.close();
}

await generatePhotos(browser, [
  `${VEHICLE_ID}/front.jpg`, `${VEHICLE_ID}/rear-plate.jpg`, `${VEHICLE_ID}/dash.jpg`, `${VEHICLE_ID}/front-r.jpg`,
]);

await runViewport("DESKTOP", { width: 1440, height: 900 });
await runViewport("MOBILE", { width: 390, height: 844 });

// ------------------------------------------- the Owner's switch reaches the UI
console.log("\n================ the Owner's switch");
{
  const { ctx, page, errors } = await openPhotosTab({ width: 1440, height: 900 }, (st) => { st.reading.enabled = false; });

  ok(await page.getByText(/Photo Reading is switched off/).count() > 0,
    "with Photo Reading off, the tab says so in words an operator can act on");
  const choose = page.getByRole("button", { name: "Choose Photos" });
  ok(await choose.isDisabled(), "  and Choose Photos is dead rather than failing on click");
  ok(state.batches.size === 0 && state.reading.usedToday === 0, "  nothing was read and nothing was spent");
  ok(errors.length === 0, "no page errors");
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
