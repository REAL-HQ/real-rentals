/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   AN UPLOAD THAT FINISHED READING MUST REACH THE REVIEW STEP.
 *
 * The outage this pins down: the Vehicle Profile upload dialog set `batchId`
 * the moment the BATCH was created — before the file was stored and before
 * registerInboxFile had run. The poll effect fired on that id, its first tick
 * saw an empty batch, computed `busy = false`, and therefore never scheduled
 * another tick. Polling was dead for the life of the dialog. When the upload
 * queue drained, onAllDone did ONE more fetch with no re-scheduling, and at
 * that instant the item was still `analyzing` — so `reading` stayed true, the
 * review gate never opened, and the Accept button never rendered. The file
 * card said "Reading…" forever over a document that had finished 14 seconds
 * earlier, with 6 extracted fields stranded in a pending proposal.
 *
 * Reading the JSX cannot tell you that. The mistake is in effect ORDERING, so
 * this drives the real dialog in a real browser against a faked pipeline whose
 * extraction deliberately finishes AFTER the upload does — the exact race —
 * and judges only what a staff member would see on screen.
 *
 * No paid document reader is ever called: every server function is stubbed.
 * No real vehicle, document or proposal is touched.
 *
 * Run: npm run dev, then npm run test:doc-upload
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { toCrossJSON, fromCrossJSON } from "seroval";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const REF = "yuyzdsnrbfhkmfzpvhwx";

/** Extraction finishes this long after the file is registered — after the
 *  upload queue has already drained. That gap IS the bug. */
const EXTRACT_MS = 4000;

const VEHICLE_ID = "061cb5e9-0000-4000-8000-000000000004";
const OTHER_ID = "061cb5e9-0000-4000-8000-000000000009";

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
  user: {
    id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated",
    email: "probe@example.com", app_metadata: {}, user_metadata: { full_name: "Probe Owner" },
    created_at: new Date().toISOString(),
  },
};

// ---------------------------------------------------------------- fake pipeline
/** A synthetic registration card. Nothing here came from a real document. */
const SYNTHETIC = {
  vin: "1SYNTH00000000001",
  license_plate: "SYN100", plate_state: "FL",
  registration_number: "SYN-000-01", registration_state: "FL",
  registration_expires_on: "2029-06-30",
};

function freshState() {
  return {
    batches: new Map(),   // id -> { id, items: [] }
    registered: 0,
    attached: [],
    attachFails: false,
    duplicateNext: false,
    coversOtherVehicle: false,
    failExtraction: false,
    applyFails: false,
    profileReads: 0,
    directSaves: [],
    registered_with: [],
    applied: [],      // "<proposalId>:<field>" — the real apply is per field
    nextId: 1,
  };
}
let state = freshState();

const vehicleRow = (id, unit, vin) => ({
  id, unit_number: unit, year: 2013, make: "Ford", model: "Fusion",
  vin, license_plate: null, current_odometer: null,
});

/** The item as getImportBatch would return it, given how long ago it landed. */
function itemView(it) {
  const age = Date.now() - it.at;
  const status = it.duplicate
    ? "duplicate"
    : age < 300
      ? "uploaded"
      : age < EXTRACT_MS
        ? "analyzing"
        : state.failExtraction
          ? "failed"
          : "ready";
  return {
    id: it.id, document_id: it.documentId, duplicate_of_document_id: null,
    file_name: it.fileName, mime_type: "image/jpeg", size_bytes: 2048,
    status, doc_class: status === "ready" ? "registration" : null,
    class_confidence: status === "ready" ? "high" : null, classified_manually: false,
    warnings: [], error: status === "failed" ? "The page was too blurred to read." : null, attempts: 1,
    extraction: status === "ready" ? { shared: {}, vehicleCount: 1 } : null,
    created_at: new Date(it.at).toISOString(), job: null,
  };
}

const PROPOSAL_FIELDS = {
  vin: { value: SYNTHETIC.vin, raw: SYNTHETIC.vin, confidence: "high" },
  license_plate: { value: SYNTHETIC.license_plate, raw: SYNTHETIC.license_plate, confidence: "high" },
  plate_state: { value: SYNTHETIC.plate_state, raw: SYNTHETIC.plate_state, confidence: "high" },
  registration_number: { value: SYNTHETIC.registration_number, raw: SYNTHETIC.registration_number, confidence: "high" },
  registration_state: { value: SYNTHETIC.registration_state, raw: SYNTHETIC.registration_state, confidence: "high" },
  registration_expires_on: { value: SYNTHETIC.registration_expires_on, raw: "06/30/2029", confidence: "high" },
};

/** The five details the synthetic registration offers, and which are "safe". */
const UNSAFE = new Set(["license_plate", "plate_state", "current_odometer", "vin"]);
const FIELD_ROWS = [
  ["license_plate", "Plate", SYNTHETIC.license_plate],
  ["plate_state", "Plate state", SYNTHETIC.plate_state],
  ["registration_number", "Registration number", SYNTHETIC.registration_number],
  ["registration_state", "Registration state", SYNTHETIC.registration_state],
  ["registration_expires_on", "Registration expiry", SYNTHETIC.registration_expires_on],
].map(([field, label, proposed]) => [field, label, proposed, !UNSAFE.has(field)]);

function proposalsFor(batch) {
  const rows = batch.items
    .filter((it) => itemView(it).status === "ready" && !it.duplicate)
    .map((it) => ({
      id: `prop-${it.id}`, batch_id: batch.id, item_id: it.id, page: null, kind: "match",
      vin: SYNTHETIC.vin, match_vehicle_id: VEHICLE_ID, match_basis: "vin_exact",
      // Mirrors the real apply: a partial accept keeps the proposal pending but
      // still stamps applied_vehicle_id.
      status: FIELD_ROWS.every(([f]) => state.applied.includes(`prop-${it.id}:${f}`)) ? "applied" : "pending",
      applied_vehicle_id: state.applied.some((a) => a.startsWith(`prop-${it.id}:`)) ? VEHICLE_ID : null,
      fields: PROPOSAL_FIELDS, changes: [], issues: [],
    }));
  if (!state.coversOtherVehicle) return rows;
  // A document that names a second car by FULL VIN — one insurance PDF
  // covering two vehicles. It must never link itself.
  return [
    ...rows,
    ...batch.items
      .filter((it) => itemView(it).status === "ready" && !it.duplicate)
      .map((it) => ({
        id: `prop-${it.id}-other`, batch_id: batch.id, item_id: it.id, page: 2, kind: "match",
        vin: "1SYNTH00000000002", match_vehicle_id: OTHER_ID, match_basis: "vin_exact",
        status: "pending", applied_vehicle_id: null, fields: PROPOSAL_FIELDS, changes: [], issues: [],
      })),
  ];
}

/** getVehicleSuggestions, derived from the same fake state — ready items only. */
function suggestionsFor() {
  const ready = [...state.batches.values()].flatMap((b) =>
    b.items.filter((it) => itemView(it).status === "ready" && !it.duplicate).map((it) => ({ b, it })));
  const out = [];
  for (const { b, it } of ready) {
    const src = {
      proposalId: `prop-${it.id}`, batchId: b.id, documentId: it.documentId,
      fileName: it.fileName, docClass: "registration", page: null,
    };
    for (const [field, label, proposed, safe] of FIELD_ROWS) {
      // applyImportDecisions with partial: true leaves the proposal pending
      // with whatever was NOT accepted, so only accepted fields disappear.
      if (state.applied.includes(`prop-${it.id}:${field}`)) continue;
      out.push({ ...src, field, label, current: null, proposed, confidence: "high",
        safe, risk: "normal", kind: "fill", evidence: { raw: proposed, note: null } });
    }
  }
  return { suggestions: out, conflicts: [], possibleMatches: [], needsVerification: [], canOwnership: true };
}

const READINESS = { lastPreDeliveryPassedAt: null, schedules: [], openIssues: [], openIncidents: [], hasActiveRental: false };

/** Has this field been written to the vehicle yet? */
const appliedField = (f) => state.applied.some((a) => a.endsWith(`:${f}`));

const profilePayload = () => ({
  vehicle: {
    id: VEHICLE_ID, unit_number: "RR-SYN", year: 2013, make: "Ford", model: "Fusion",
    trim: null, color: "Blue", body_type: null, vin: SYNTHETIC.vin, status: "onboarding",
    license_plate: appliedField("license_plate") ? SYNTHETIC.license_plate : null,
    plate_state: appliedField("plate_state") ? SYNTHETIC.plate_state : null,
    registration_number: appliedField("registration_number") ? SYNTHETIC.registration_number : null,
    registration_state: appliedField("registration_state") ? SYNTHETIC.registration_state : null,
    registration_expires_on: appliedField("registration_expires_on") ? SYNTHETIC.registration_expires_on : null,
    insurance_carrier: null, insurance_policy_number: null,
    insurance_effective_on: null, insurance_expires_on: null, current_odometer: null,
    weekly_rate: 350, monthly_rate: 1400, deposit: 300, seats: 5, doors: 4,
    title_number: null, title_status: null, archived_at: null, notes: null,
  },
  finance: null, canSeeFinance: true, canEdit: true,
  unitLabel: "RR-SYN", vinLast4: "0001", isActive: true,
  currentRental: null, partnerName: null,
  counts: { documents: 0, sharedDocuments: 0, openMaintenance: 0, inspections: 0, rentals: 0, photos: 0, publishedPhotos: 0 },
  profileContext: { docKinds: [], maintenanceCount: 0, inspectionCount: 0, photoCount: 0 },
  alerts: [], nextService: null, financials: null, readinessFacts: READINESS,
});

// ---------------------------------------------------------------- server fns
function serverFn(name, input) {
  switch (true) {
    case /createImportBatch/.test(name): {
      const id = `batch-${state.nextId++}`;
      state.batches.set(id, { id, items: [] });
      return { id };
    }
    case /registerInboxFile/.test(name): {
      state.registered_with.push({ intendedClass: input?.intendedClass ?? null, expiresAt: input?.expiresAt ?? null });
      if (state.duplicateNext) {
        const b0 = state.batches.get(input?.batchId);
        const n0 = ++state.registered;
        const it0 = { id: `item-${n0}`, documentId: "doc-existing", fileName: input?.fileName ?? "f.jpg", at: Date.now(), duplicate: true };
        if (b0) b0.items.push(it0);
        return { itemId: it0.id, duplicate: true, existingFileName: "already-on-file.jpg" };
      }
      const b = state.batches.get(input?.batchId);
      const n = ++state.registered;
      const it = { id: `item-${n}`, documentId: `doc-${n}`, fileName: input?.fileName ?? "file.jpg", at: Date.now() };
      if (b) b.items.push(it);
      return { itemId: it.id, duplicate: false, existingFileName: null };
    }
    case /attachInboxItem/.test(name):
      if (state.attachFails) return { ok: false, error: "File or vehicle not found." };
      state.attached.push(`${input?.itemId}:${input?.vehicleId}`);
      return { ok: true };
    case /getImportBatch/.test(name): {
      const b = state.batches.get(input?.batchId);
      if (!b) throw new Error("Not found");
      return {
        batch: { id: b.id, label: "Synthetic", status: "processing", created_at: new Date().toISOString(), source_channel: "vehicle_profile" },
        items: b.items.map(itemView), proposals: proposalsFor(b), transactions: [], finance: [],
        vehicles: (() => {
          const all = [vehicleRow(VEHICLE_ID, "RR-SYN", SYNTHETIC.vin), vehicleRow(OTHER_ID, "RR-SYN2", "1SYNTH00000000002")];
          if (input?.vehicleScope !== "referenced") return all;
          // Mirrors the server: only the vehicles this batch's proposals name.
          const ids = new Set(proposalsFor(b).map((p) => p.match_vehicle_id).filter(Boolean));
          return all.filter((v) => ids.has(v.id));
        })(),
        canFinance: true, email: null, queue: { pausedReason: null, pausedAt: null },
      };
    }
    case /getVehicleSuggestions/.test(name):
      return suggestionsFor();
    case /applyImportDecisions/.test(name): {
      if (state.applyFails) {
        return {
          results: (input?.decisions ?? []).map((d) => ({
            proposalId: d.proposalId, ok: false,
            message: "VIN conflict: 3FA6P0HRXDR153036 on file vs 1SYNTH00000000001 in document.",
          })),
        };
      }
      const results = (input?.decisions ?? []).map((d) => {
        for (const f of d.acceptFields ?? []) state.applied.push(`${d.proposalId}:${f}`);
        // The itemised answer the server gives: the panel reads these arrays,
        // not the sentence. A stub that returns only the sentence is testing a
        // contract the server no longer has.
        return { proposalId: d.proposalId, ok: true, vehicleId: VEHICLE_ID,
          message: `${(d.acceptFields ?? []).length} change(s) applied.`,
          applied: [...(d.acceptFields ?? [])], unchanged: [], needsConfirmation: [], rejected: [] };
      });
      return { results };
    }
    case /getFleetDocumentFile/.test(name):
      // A 1x1 PNG. The preview only has to render something real.
      return {
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
        mimeType: "image/png", fileName: "synthetic-registration.jpg",
      };
    case /registerVehicleDoc/.test(name):
      state.directSaves.push({ kind: input?.kind, expiresAt: input?.expiresAt ?? null, path: input?.path });
      return { ok: true, id: `vdoc-${state.directSaves.length}` };
    case /getVehicleProfile/.test(name):
      state.profileReads++;
      return profilePayload();
    case /getVehicleDocAccess/.test(name):
      return { financeSlots: true };
    case /listVehicleDocs/.test(name):
      // Slot documents the vehicle owns: only the direct-save path makes these.
      return state.directSaves.map((d, i) => ({
        id: `vdoc-${i + 1}`, vehicle_id: VEHICLE_ID, kind: d.kind, kind_label: d.kind,
        label: d.kind, file_name: "synthetic-registration.jpg", storage_path: "",
        expires_at: d.expiresAt, days_until_expiry: null, notes: null,
        created_at: new Date().toISOString(), url: null,
      }));
    case /listVehicleLinkedDocs/.test(name):
      // Fleet Inbox originals linked to this vehicle — what the reader path makes.
      return [...state.batches.values()].flatMap((b) =>
        b.items
          .filter((it) => state.attached.includes(`${it.id}:${VEHICLE_ID}`))
          .map((it) => ({
            id: it.documentId,
            kind: itemView(it).status === "ready" ? "registration" : "unknown",
            label: it.fileName, file_name: it.fileName,
            created_at: new Date(it.at).toISOString(), is_current: true,
            review_status: "uploaded", source: "fleet_inbox",
            expires_at: null, page: null, relatedVehicles: 1,
          })),
      );
    case /getVehicleFinance/.test(name):
      return null;
    case /listVehicles/.test(name):
      return { rows: [], total: 0, page: 1, pageSize: 25 };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- harness
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function openDialog(viewport) {
  state = freshState();
  const ctx = await browser.newContext({ viewport });
  await ctx.route(`**://${REF}.supabase.co/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    if (url.includes("/storage/v1/"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "vehicle-docs/inbox/x.jpg" }) });
    const isHead = route.request().method() === "HEAD";
    return route.fulfill({
      status: 200, contentType: "application/json", headers: { "content-range": "0-0/0" },
      body: isHead ? "" : JSON.stringify(url.includes("user_roles") ? [{ role: "admin" }] : []),
    });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 300)));
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    [`sb-${REF}-auth-token`, JSON.stringify(session)]);

  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    let name = "";
    try { name = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch { /* not ours */ }
    // Server-fn payloads are seroval cross-JSON, not plain JSON.
    let input = null;
    try {
      const post = route.request().postData();
      // The body is { t: <seroval cross-JSON node>, f, m }.
      if (post) input = fromCrossJSON(JSON.parse(post).t, { refs: new Map() })?.data ?? null;
    } catch { /* no body */ }
    try {
      const result = serverFn(name, input);
      if (process.env.TRACE) console.log(`    [fn] ${name.slice(-60)} in=${JSON.stringify(input)?.slice(0,80)} out=${JSON.stringify(result)?.slice(0,60)}`);
      return route.fulfill({
        status: 200, contentType: "application/json", headers: { "x-tss-serialized": "true" },
        body: JSON.stringify(toCrossJSON({ result, context: {} }, { refs: new Map() })),
      });
    } catch (e) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: String(e?.message ?? e) }) });
    }
  });

  await page.goto(`${BASE}/admin?tab=vehicles&id=${VEHICLE_ID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  return { ctx, page, errors };
}

const dialog = (page) => page.locator('[role="dialog"][aria-label="Upload Vehicle Document"]');

/** A 1x1 JPEG. Content is irrelevant — the reader is stubbed — but it must be
 *  a real, non-empty image so FileUploader's validation accepts it. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDc0NP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A/v4oooA//9k=",
  "base64",
);

async function openDocumentsTab(page) {
  // The profile's tab strip is plain buttons inside its <nav>.
  await page.locator("nav button").filter({ hasText: "Documents" }).first().click();
  await page.waitForTimeout(1500);
}

async function uploadSynthetic(page) {
  // The Registration card row's Upload button opens the dialog.
  await page.getByRole("button", { name: /^Upload$/ }).first().click();
  await page.waitForTimeout(600);
  await dialog(page).locator('input[type="file"]').first()
    .setInputFiles({ name: "synthetic-registration.jpg", mimeType: "image/jpeg", buffer: JPEG });
}

const screen = (page) => dialog(page).innerText();
/** Everything after a section heading, so the Document Type <select> options
 *  can't satisfy an assertion about the file's detected class. */
const pastMarker = (text, marker) => text.split(marker)[1] ?? "";

// ================================================================ scenarios
console.log("THE REVIEW STEP APPEARS ONCE READING FINISHES  (desktop)");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  const shell = await page.evaluate(() => document.body.innerText);
  ok(!/could not be loaded/.test(shell), "the vehicle profile loaded");
  await openDocumentsTab(page);
  ok(/Not on file/.test(await page.evaluate(() => document.body.innerText)), "the Documents tab lists its paperwork slots");
  ok(await dialog(page).count() === 0, "no upload dialog before the Upload button is used");

  await uploadSynthetic(page);

  // Upload itself finishes long before extraction does — the race.
  await page.waitForTimeout(1500);
  ok(state.registered === 1, "the file reached registerInboxFile");
  ok(state.attached.length === 1, "  and was linked to this vehicle");

  // Now let extraction finish, and give the dialog generous time to notice.
  await page.waitForTimeout(EXTRACT_MS + 7000);
  const after = await screen(page);
  if (process.env.DUMP) console.log("\n----- DIALOG -----\n" + after + "\n------------------\n");
  // Scoped past the Document Type <select>, whose options also say
  // "Registration card" — matching the whole dialog gives false positives.
  const filed = pastMarker(after, "Uploaded Files");

  ok(/Uploaded Files/.test(after), "the dialog shows what the pipeline recorded for this upload");
  ok(!/Reading…/.test(filed), "  the file no longer claims to be Reading… after extraction finished");
  ok(/Registration/.test(filed), "  the detected document class is shown");
  ok(/Details Found In Documents/.test(after), "THE REVIEW STEP IS ON SCREEN");
  ok(/Accept Selected/.test(after), "  and staff are offered an explicit Accept");
  ok(/Not Set/.test(after), "  showing the existing vehicle value beside the proposed one");
  ok(!/\bCancel\b/.test(after), "  and nothing offers Cancel over an already-saved file");

  // The three steps, and which one the dialog says it is on. A completed step
  // renders a tick rather than its number, so this asserts on the names and on
  // aria-current, not on "1." being present.
  const steps = await dialog(page).locator('ol[aria-label="Upload Steps"]').innerText();
  ok(/Upload/.test(steps) && /Review/.test(steps) && /Save Changes/.test(steps),
     `the three steps are named on screen (${steps.replace(/\s+/g, " ")})`);
  const current = await dialog(page).locator('[aria-current="step"]').innerText();
  ok(/Review/.test(current), `  and the dialog is on Review before anything is applied (on "${current}")`);
  ok(/Ready For Review/.test(filed), "the file reads Ready For Review once details are waiting");
  ok(/Closing this window will not remove it/.test(after),
     "it says plainly that the file is already committed");
  ok(/Save Document Only/.test(after), "Save Document Only is offered");
  ok(/The Document/.test(after), "the original is shown beside the values");
  const shot = await dialog(page).locator("img[alt='Uploaded document'], iframe[title='Uploaded document']").count();
  ok(shot > 0, "  and it really renders the document, not just a heading");
  ok(state.registered_with[0]?.intendedClass === "registration",
     `the staff-chosen type is sent as the fallback class (got ${state.registered_with[0]?.intendedClass})`);

  // And accepting must actually apply, with an honest result message.
  const box = dialog(page).locator('input[type="checkbox"]').last();
  if (await box.count()) {
    await box.check().catch(() => {});
    await dialog(page).getByRole("button", { name: /Accept Selected/ }).click().catch(() => {});
    await page.waitForTimeout(2500);
    ok(state.applied.length > 0, "Accept Selected reaches applyImportDecisions");
    const saved = await screen(page);
    ok(/Saved \d+ Detail/.test(saved), "  and reports what was saved");
    ok(/Save Changes/.test(await dialog(page).locator('[aria-current="step"]').innerText()),
       "  the dialog advances to step 3");
    ok(/Vehicle Profile Updated/.test(pastMarker(saved, "Uploaded Files")),
       "  and the file reads Vehicle Profile Updated");
    ok(!/Save Document Only/.test(saved),
       "  Save Document Only is withdrawn once the profile has been changed");
  } else {
    ok(false, "Accept Selected reaches applyImportDecisions");
    ok(false, "  and reports what was saved");
  }

  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nTHE SAME, ON A PHONE  (375x812)");
{
  const { ctx, page, errors } = await openDialog({ width: 375, height: 812 });
  await openDocumentsTab(page);
  await uploadSynthetic(page);
  await page.waitForTimeout(EXTRACT_MS + 7000);
  const after = await screen(page);
  ok(/Details Found In Documents/.test(after), "the review step is reachable at phone width");
  ok(!/Reading…/.test(after), "  and nothing is stuck on Reading…");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, "  with no horizontal page scroll");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nA FILE THAT CANNOT BE LINKED MUST NOT LOOK LIKE A SUCCESS");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await openDocumentsTab(page);
  state.attachFails = true;
  await uploadSynthetic(page);
  await page.waitForTimeout(4000);
  const after = await screen(page);
  ok(state.registered === 1, "the file was still stored and recorded");
  ok(state.attached.length === 0, "  but the vehicle link failed");
  ok(!/·\s*Uploaded/.test(after), "the queue does NOT report it as uploaded");
  ok(/could not link it to this vehicle|File or vehicle not found/.test(after),
     "  it says the file is saved but unlinked, and where to fix it");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nSAVING THE FILE WITHOUT READING IT STILL COMMITS IT");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await openDocumentsTab(page);
  await page.getByRole("button", { name: /^Upload$/ }).first().click();
  await page.waitForTimeout(600);
  // Turn the reader off, set an expiry, then add the file.
  await dialog(page).locator('input[type="checkbox"]').first().uncheck();
  await dialog(page).locator('input[type="date"]').first().fill("2029-06-30");
  await dialog(page).locator('input[type="file"]').first()
    .setInputFiles({ name: "synthetic-registration.jpg", mimeType: "image/jpeg", buffer: JPEG });
  await page.waitForTimeout(3000);
  const after = await screen(page);
  ok(state.directSaves.length === 1, "the file went through the direct save path");
  ok(state.directSaves[0]?.expiresAt === "2029-06-30",
     `  carrying the expiry that was typed (got ${state.directSaves[0]?.expiresAt})`);
  ok(/Closing this window will not remove it/.test(after), "the dialog says the file is already saved");
  ok(!/\bCancel\b/.test(after), "THE FOOTER NO LONGER SAYS CANCEL OVER A SAVED FILE");
  ok(/\bDone\b/.test(after), "  it says Done");
  ok(state.registered === 0, "nothing was sent to the reader");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nA DUPLICATE SAYS WHAT ACTUALLY HAPPENED");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await openDocumentsTab(page);
  state.duplicateNext = true;
  await uploadSynthetic(page);
  await page.waitForTimeout(5000);
  const after = await screen(page);
  ok(/already on file/.test(after) && /not stored again/.test(after),
     "it says the file was linked rather than stored twice");
  ok(!/already has every value the document shows/.test(after),
     "  and does NOT claim the vehicle already has every value");
  ok(/Fleet Inbox/.test(after), "  and says where the first reading's details are");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nTHE REVIEW SURVIVES CLOSING AND REOPENING THE DIALOG");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await openDocumentsTab(page);
  await uploadSynthetic(page);
  await page.waitForTimeout(EXTRACT_MS + 7000);
  ok(/Details Found In Documents/.test(await screen(page)), "the review is there before closing");

  await dialog(page).getByRole("button", { name: /^Done$/ }).click();
  await page.waitForTimeout(1500);
  ok(await dialog(page).count() === 0, "the dialog closed");

  await page.getByRole("button", { name: /^Upload$/ }).first().click();
  await page.waitForTimeout(2500);
  const again = await screen(page);
  ok(/Details Found In Documents/.test(again), "AND THE PENDING DETAILS ARE STILL REVIEWABLE ON REOPEN");
  ok(/Accept Selected/.test(again), "  with the Accept button still offered");
  ok(/\bCancel\b/.test(again), "  a fresh dialog with nothing uploaded in it may say Cancel");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nA DOCUMENT COVERING TWO CARS LINKS ONLY WHEN SOMEBODY SAYS SO");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await openDocumentsTab(page);
  state.coversOtherVehicle = true;
  await uploadSynthetic(page);
  await page.waitForTimeout(EXTRACT_MS + 7000);
  const after = await screen(page);

  ok(/also covers other vehicles/.test(after), "the dialog says the document covers another vehicle");
  ok(/matched by full VIN/.test(after), "  and that the match was on the full VIN");
  ok(/RR-SYN2/.test(after), "  naming the other car");
  // One link from the upload itself, to THIS vehicle. Nothing else yet.
  ok(state.attached.length === 1 && state.attached[0].endsWith(VEHICLE_ID),
     `NOTHING WAS LINKED TO THE OTHER CAR WITHOUT A CLICK (${state.attached.join(", ")})`);

  await dialog(page).getByRole("button", { name: /^Link$/ }).first().click();
  await page.waitForTimeout(2000);
  ok(state.attached.some((a) => a.endsWith(OTHER_ID)), "  pressing Link attaches the same file to it");
  ok(state.registered === 1, "  the original was never stored a second time");
  ok(/Linked/.test(await screen(page)), "  and the button reports it is done");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

/** Upload one synthetic file and wait for reading to finish. */
async function uploadAndWaitForReview(page) {
  await openDocumentsTab(page);
  await uploadSynthetic(page);
  await page.waitForTimeout(EXTRACT_MS + 7000);
}
const pageText = (page) => page.evaluate(() => document.body.innerText);

console.log("\nACCEPTING DETAILS REACHES THE VEHICLE, NOT JUST THE DIALOG");
{
  // The defect this pins down: the apply wrote the right fields and the dialog
  // said "Saved 5 Details.", but nothing re-read the vehicle. Staff closed the
  // dialog and the Overview tab and the Readiness checklist still said "Not
  // Set" for the plate they had just saved — the same "did it save?" confusion
  // the whole repair exists to remove.
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await uploadAndWaitForReview(page);

  // Captured BEFORE the click: the refresh fires as soon as the apply returns,
  // so sampling afterwards cannot see it.
  const readsBefore = state.profileReads;
  await dialog(page).getByRole("button", { name: /Approve Safe Fields/ }).click();
  await page.waitForTimeout(3000);
  ok(state.applied.length > 0, "the fields were applied server-side");
  ok(/Saved \d+ Detail/.test(await screen(page)), "  and the dialog confirms the save");
  ok(state.profileReads > readsBefore,
     `the vehicle profile was re-read after the save (reads ${readsBefore} -> ${state.profileReads})`);

  await dialog(page).getByRole("button", { name: /^Done$/ }).click();
  await page.waitForTimeout(2000);

  // The registration details it DID apply must now be on the record. (Plate,
  // plate state, VIN and mileage are excluded from Approve Safe Fields by
  // design and need individual confirmation.)
  await page.locator("nav button").filter({ hasText: "DMV" }).first().click();
  await page.waitForTimeout(1500);
  const dmv = await pageText(page);
  ok(new RegExp(SYNTHETIC.registration_number).test(dmv),
     "THE ACCEPTED REGISTRATION NUMBER IS ON THE VEHICLE WITHOUT A MANUAL REFRESH");
  ok(/2029/.test(dmv), "  and so is the accepted registration expiry");

  // And Vehicle Readiness, which reads the same vehicle record, has moved with
  // it: the Registration row was "Not Verified" with no date on file.
  await page.locator("nav button").filter({ hasText: "Overview" }).first().click();
  await page.waitForTimeout(1500);
  const overview = await pageText(page);
  // Just this row: the next one is Insurance, which is legitimately "Not
  // Verified" here and would otherwise bleed into the window.
  const regRow = (overview.split(/Registration/)[1] ?? "").split(/Insurance/)[0] ?? "";
  ok(/Expires 06-30-2029/.test(regRow),
     `VEHICLE READINESS SHOWS THE NEW REGISTRATION EXPIRY (${regRow.replace(/\s+/g, " ").trim().slice(0, 60)})`);
  ok(!/Not Verified/.test(regRow), "  and no longer reports it as Not Verified");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nUPLOADING AND POLLING MUST NOT RE-READ THE WHOLE PROFILE");
{
  // The profile is a far heavier read than the batch. Re-fetching it on every
  // three-second tick would be waste, so only a real write may trigger it.
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await openDocumentsTab(page);
  const settled = state.profileReads;
  await uploadSynthetic(page);
  await page.waitForTimeout(EXTRACT_MS + 7000);
  ok(state.profileReads === settled,
     `uploading and several poll ticks re-read the profile 0 times (was ${settled}, now ${state.profileReads})`);
  ok(/Details Found In Documents/.test(await screen(page)), "  while the review still arrived");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nTHE WORKFLOW SURVIVES A FULL PAGE RELOAD");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await uploadAndWaitForReview(page);
  ok(/Details Found In Documents/.test(await screen(page)), "the review is on screen before the reload");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  ok(await dialog(page).count() === 0, "after a reload the dialog is closed, as it should be");

  await openDocumentsTab(page);
  ok(/On file/.test(await pageText(page)), "the document is still on file");

  await page.getByRole("button", { name: /^Upload$|^Replace$/ }).first().click();
  await page.waitForTimeout(2500);
  const again = await screen(page);
  ok(/Details Found In Documents/.test(again), "AND THE PENDING DETAILS ARE STILL REVIEWABLE");
  ok(/Accept Selected/.test(again), "  with the Accept button offered");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nAN APPLY THE SERVER REFUSES IS NOT A SUCCESS");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  await uploadAndWaitForReview(page);
  state.applyFails = true;
  const readsBefore = state.profileReads;
  await dialog(page).getByRole("button", { name: /Approve Safe Fields/ }).click();
  await page.waitForTimeout(3000);
  const after = await screen(page);
  ok(/VIN conflict/.test(after), "the server's refusal is shown verbatim");
  ok(!/Saved \d+ Detail/.test(after), "NO SAVE IS CLAIMED");
  ok(!/Vehicle Profile Updated/.test(pastMarker(after, "Uploaded Files")),
     "  the file does not claim the profile was updated");
  ok(!/Save Changes/.test(await dialog(page).locator('[aria-current="step"]').innerText()),
     "  and the step bar does not advance to Save Changes");
  ok(state.profileReads === readsBefore,
     `  nothing re-read the vehicle over a refusal (reads stayed at ${readsBefore})`);
  ok(/Accept Selected|Approve Safe Fields/.test(after), "  the details are still offered for another try");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nA READING THAT FAILS KEEPS THE FILE AND SAYS SO");
{
  const { ctx, page, errors } = await openDialog({ width: 1440, height: 1000 });
  state.failExtraction = true;
  await uploadAndWaitForReview(page);
  const after = await screen(page);
  const filed = pastMarker(after, "Uploaded Files");
  ok(/Could Not Read/.test(filed), "the file is marked as unreadable");
  ok(/Document Saved/.test(filed), "  but never below Document Saved — the original IS kept");
  ok(/too blurred/.test(filed), "  with the reason the reader gave");
  ok(/saved and linked/.test(filed), "  and says in words that the file is safe");
  ok(/Nothing could be read/.test(after), "the review explains there is nothing to review");
  ok(!/already has every value/.test(after), "  and does NOT claim the vehicle already has the values");
  ok(!/Vehicle Profile Updated/.test(filed), "  nothing claims the profile changed");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
