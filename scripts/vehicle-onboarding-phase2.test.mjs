/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A SAVE SAYS WHAT IT DID. "SAVED" IS NOT AN ANSWER WHEN A FIELD WAS DROPPED.
 *   A FIELD REFUSED FOR PERMISSION IS REPORTED, NOT SWALLOWED.
 *   READINESS IN THE LIST IS THE SAME TWO RULES AS EVERYWHERE ELSE, AND GATES NOTHING.
 *   FLEET-WIDE COUNTS COUNT THE FLEET, NOT THE PAGE.
 *   PAPERWORK AT ADD TIME IS AN OFFER: THE CAR IS ALREADY SAVED.
 *
 * Vehicle Onboarding Phase 2, areas 1–3. Area 4 (manual plate editing) has its
 * own suite in scripts/vehicle-plate-editing.test.mjs.
 *
 * Three things were silently true before this work, and each one is a lie the
 * operator could act on:
 *
 *   A Manager typing a title number saw "Saved". The column is Owner-only and
 *   the value went nowhere — so the next person to look for it found nothing
 *   and had no reason to think it had ever been typed.
 *
 *   Accepting an extracted detail reported a count parsed out of the result
 *   SENTENCE with a regular expression, and four distinct outcomes — not an
 *   Owner, not individually confirmed, unusable value, already that value —
 *   were all reported as the same silence.
 *
 *   "Which cars still need work?" could only be answered by opening every
 *   record in turn. The readiness rules existed; nothing showed them across
 *   the fleet, and nothing let you filter by them.
 *
 * Real modules, fake Supabase, synthetic vehicles. No network, no paid call,
 * no real record.
 *
 * Run: node scripts/vehicle-onboarding-phase2.test.mjs  (npm run test:onboarding2)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".phase2-build";
const VIN = "1HGCM82633A004352";
const VIN2 = "1HGCM82633A004353";
const V1 = "dddddddd-0000-4000-8000-000000000001";
const V2 = "dddddddd-0000-4000-8000-000000000002";
const V3 = "dddddddd-0000-4000-8000-000000000003";
const V4 = "dddddddd-0000-4000-8000-000000000004";
const BATCH = "eeeeeeee-0000-4000-8000-00000000000b";
const MEDIA = "eeeeeeee-0000-4000-8000-00000000000d";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });
writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
// The real roles.server and experience.server are used throughout: the tier
// comes from a seeded user_roles row, so "a Manager cannot write a title
// number" is the real gate answering, not a stub agreeing with the test.
writeFileSync(`${OUT}/stub/react-start-server.js`, `
export const getRequest = () => ({ headers: new Map() });
export const getRequestHeader = () => (globalThis.__fakeSb?.experience ?? null);
`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub/audit-server.js`, `
export const logAudit = async (actor, entry) => { (globalThis.__fakeSb.audit ??= []).push({ actor: actor?.role ?? null, ...entry }); };
`);
writeFileSync(`${OUT}/stub/reader.js`, `
const S = (globalThis.__fakeSb ??= {});
export const READER_MAX_BYTES = 20971520;
export async function readDocument() { return { ok: true, text: JSON.stringify(S.readerPayload) }; }
export function parseModelJson(t) {
  const c = t.trim();
  const a = c.indexOf("{"), b = c.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? c.slice(a, b + 1) : c);
}
`);

const alias = [
  "--alias:@=./src",
  `--alias:@tanstack/react-start/server=./${OUT}/stub/react-start-server.js`,
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/supabase.js`,
  `--alias:@/lib/audit.server=./${OUT}/stub/audit-server.js`,
  `--alias:@/lib/document-reader.server=./${OUT}/stub/reader.js`,
];
const build = (entry, out) =>
  execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/${out}`, ...alias],
    { stdio: ["ignore", "ignore", "inherit"] });

build("src/lib/vehicles.functions.ts", "vehicles.mjs");
build("src/lib/vehicles-list.functions.ts", "list.mjs");
build("src/lib/vehicles-list.ts", "listrules.mjs");
build("src/lib/vehicle-photo-analysis.functions.ts", "photo.mjs");
build("src/lib/fleet-inbox.functions.ts", "inbox.mjs");

const { updateVehicleSection, updateVehicleSections } = await import(`../${OUT}/vehicles.mjs`);
const { listVehicles } = await import(`../${OUT}/list.mjs`);
const L = await import(`../${OUT}/listrules.mjs`);
const { readVehiclePhoto } = await import(`../${OUT}/photo.mjs`);
const { analyzeInboxItem, applyImportDecisions, getVehicleSuggestions } = await import(`../${OUT}/inbox.mjs`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const call = (fn, data, userId = "own-1") =>
  fn({ data: fn._validate ? fn._validate(data) : data, context: { userId } });
const ROLES = [
  { user_id: "own-1", role: "admin" },
  { user_id: "mgr-1", role: "team" },
  { user_id: "crd-1", role: "coordinator" },
];
const labels = (xs) => (xs ?? []).map((x) => x.label).sort();
const fields = (xs) => (xs ?? []).map((x) => x.field).sort();

// =========================================================================
// 2. SAVE FEEDBACK — what the drawers are told
// =========================================================================
function seedOne({ color = "Blue", title = null } = {}) {
  S.experience = null;
  S.tables = {
    user_roles: ROLES,
    vehicles: [{
      id: V1, unit_number: "SYN-1", year: 2013, make: "Ford", model: "Fusion", color,
      vin: VIN, license_plate: "ABC1234", plate_state: "FL", status: "onboarding",
      archived_at: null, title_on_file: !!title, current_odometer: 1000, weekly_rate: 350,
    }],
    vehicle_titles: title ? [{ vehicle_id: V1, ...title }] : [],
    rentals: [], audit_log: [],
  };
  S.log = []; S.audit = []; S.defaults = {};
}
const car = () => S.tables.vehicles.find((v) => v.id === V1);
const titleRow = () => S.tables.vehicle_titles.find((t) => t.vehicle_id === V1);
/** What a per-section drawer posts: the whole record, plus what was edited. */
const post = (section, edits, userId = "own-1") =>
  call(updateVehicleSection, { id: V1, section, values: { ...car(), ...edits }, intended: Object.keys(edits) }, userId);

console.log("\na save names what it changed");
seedOne();
let r = await post("identity", { color: "Silver" });
ok(r.ok === true, "the save is accepted");
ok(labels(r.saved).join() === "color", `saved names the colour only (${labels(r.saved).join()})`);
ok((r.unchanged ?? []).length === 0, "  and does not report the 19 columns nobody touched");
ok(car().color === "Silver", "  the colour really moved");

console.log("\npressing Save with nothing changed is not a save");
seedOne();
r = await post("identity", { color: "Blue" });
ok(r.ok === true && (r.saved ?? []).length === 0, "nothing is reported as saved");
ok(labels(r.unchanged).join() === "color", "  the field is reported as already that value");

console.log("\na field this section does not own is reported, not swallowed");
seedOne();
r = await post("identity", { vin: "1HGCM82633A004399" });
ok(r.ok === true, "the save itself succeeds");
ok(fields(r.ignored).join() === "vin", "the VIN is reported as ignored");
ok(/does not save that field/.test(r.ignored[0].reason), `  with a reason (${r.ignored[0].reason})`);
ok(car().vin === VIN, "  and the VIN on the car is untouched — the whitelist still decides");

console.log("\na Manager's title number is refused, and the Manager is told");
seedOne();
r = await post("dmv", { title_number: "T-12345" }, "mgr-1");
ok(r.ok === true, "the rest of the save goes through");
ok(fields(r.rejected).join() === "title_number", "the title number comes back as rejected");
ok(/Owner-only/i.test(r.rejected[0].reason), `  saying why (${r.rejected[0].reason})`);
ok(!titleRow(), "  and nothing was written to the Owner-only table");
ok((r.saved ?? []).length === 0, "  it is not reported as saved");
// The refusal must not become a way to read an Owner-only value back.
ok(Object.keys(r.rejected[0]).sort().join() === "field,label,reason",
  `  the refusal carries no value, only the field and why (${Object.keys(r.rejected[0]).sort().join()})`);

console.log("\nan Owner's title number is recorded, and says so once");
seedOne();
r = await post("dmv", { title_number: "T-12345" }, "own-1");
ok(labels(r.saved).join() === "title number", "the first save records it");
ok(titleRow()?.title_number === "T-12345", "  in vehicle_titles, not on the vehicle row");
ok(car().title_on_file === true, "  and the staff-readable flag follows");
ok(car().title_number === undefined || car().title_number === null, "  the identifier never lands on the vehicles row");
r = await post("dmv", { title_number: "T-12345" }, "own-1");
ok((r.saved ?? []).length === 0 && labels(r.unchanged).join() === "title number",
  "saving the same number again reports unchanged, not saved");

console.log("\nan Owner in the Admin experience is not in the Owner view");
seedOne();
S.experience = "admin";
r = await post("dmv", { title_number: "T-999" }, "own-1");
ok(fields(r.rejected).join() === "title_number", "the narrowed view is refused like a Manager");
ok(!titleRow(), "  and wrote nothing");
S.experience = null;

console.log("\nthe legacy caller — no `intended` — still gets an answer");
seedOne();
r = await call(updateVehicleSection, { id: V1, section: "identity", values: { ...car(), color: "Grey" } }, "own-1");
ok(labels(r.saved).join() === "color", "the change is still named");
ok((r.unchanged ?? []).length > 0, "  and the rest of the section is reported as unchanged, not as saved");

console.log("\nediting a vehicle is still Manager-and-above");
seedOne();
let threw = null;
try { await post("identity", { color: "Red" }, "crd-1"); } catch (e) { threw = e; }
ok(!!threw && /Forbidden/.test(String(threw.message)), "a Coordinator is refused");
ok(car().color === "Blue", "  and wrote nothing");

console.log("\nthe whole-vehicle editor gets one merged answer");
seedOne();
r = await call(updateVehicleSections, {
  id: V1,
  sections: { identity: { color: "Green" }, dmv: { title_number: "T-77", registration_number: "R-1" } },
}, "mgr-1");
ok(r.ok === true, "the multi-section save succeeds");
ok(labels(r.saved).join() === "colour,registration number".replace("colour", "color"),
  `both written fields are named (${labels(r.saved).join()})`);
ok(fields(r.rejected).join() === "title_number", "  and the Owner-only one is named as rejected");
ok(car().color === "Green" && car().registration_number === "R-1", "  what was allowed was written");
ok(!titleRow(), "  what was not, was not");

// =========================================================================
// 2b. SAVE FEEDBACK — accepting details read from a document
// =========================================================================
const REG_READING = {
  license_plate: { value: "ZZZ999", raw: "ZZZ999", confidence: "high" },
  plate_state: { value: "FL", raw: "FL", confidence: "high" },
  registration_number: { value: "R-000-01", raw: "R-000-01", confidence: "high" },
  registration_expires_on: { value: "2029-06-30", raw: "2029-06-30", confidence: "high" },
  title_number: { value: "T-5555", raw: "T-5555", confidence: "high" },
  vin: { value: VIN, raw: VIN, confidence: "high" },
};

function seedInbox({ plate = null, vin = VIN, state = null } = {}) {
  S.experience = null;
  S.defaults = { fleet_import_proposals: { status: "pending" }, fleet_import_items: { status: "uploaded" } };
  S.tables = {
    user_roles: ROLES,
    app_settings: [
      { key: "safe_autofill", value: { enabled: true, daily_cap: 50, paused_at: null, paused_reason: null } },
      { key: "photo_reading", value: { enabled: true, daily_limit: 100, paused_reason: null, paused_at: null,
        usage_date: new Date().toISOString().slice(0, 10), used_today: 0, version: 1 } },
    ],
    vehicles: [{
      id: V1, unit_number: "SYN-1", year: 2013, make: "Ford", model: "Fusion", vin,
      color: null, body_type: null, trim: null, license_plate: plate, plate_state: state,
      registration_number: null, registration_state: null, registration_expires_on: null,
      insurance_carrier: null, current_odometer: null, archived_at: null, title_on_file: false,
      weekly_rate: 350, status: "onboarding",
    }],
    vehicle_titles: [], vehicle_field_provenance: [], vehicle_autofill_events: [],
    vehicle_media: [{ id: MEDIA, vehicle_id: V1, kind: "original", storage_bucket: "vehicle-photos",
      storage_path: `${V1}/reg-card.jpg`, file_name: "reg-card.jpg", mime_type: "image/jpeg", size_bytes: 2048 }],
    fleet_import_batches: [{ id: BATCH, source_channel: "vehicle_photo", status: "uploading" }],
    fleet_import_items: [], fleet_import_proposals: [], fleet_import_finance_facts: [],
    fleet_inbox_jobs: [], fleet_service_transactions: [], documents: [], document_vehicle_links: [],
    odometer_readings: [], audit_log: [], rentals: [],
  };
  S.files = { [`vehicle-photos/${V1}/reg-card.jpg`]: [0xff, 0xd8, 0xff, 0xe0] };
  S.log = []; S.audit = [];
  S.readerPayload = { documentClass: "registration", classConfidence: "high", pageCount: 1, shared: {},
    vehicles: [{ page: 1, fields: REG_READING }], warnings: [] };
}

/** Upload → read → the proposal a person is about to act on. */
async function readRegistration(userId = "own-1") {
  const q = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: V1, mediaId: MEDIA, intendedClass: "condition_photo" }, userId);
  await call(analyzeInboxItem, { itemId: q.itemId }, userId);
  const p = S.tables.fleet_import_proposals[0];
  return p;
}
const applyFields = (p, acceptFields, confirmHighRisk = [], userId = "own-1") =>
  call(applyImportDecisions, {
    batchId: BATCH,
    decisions: [{ proposalId: p.id, action: "match", vehicleId: V1, acceptFields, confirmHighRisk, applyFinance: false, partial: true }],
  }, userId);

console.log("\na high-risk field accepted without its tick is reported as waiting");
seedInbox();
let prop = await readRegistration();
let res = await applyFields(prop, ["title_number", "registration_number"], []);
let out = res.results[0];
ok(out.ok === true, "the apply reports success for what it could do");
ok((out.applied ?? []).includes("registration_number"), "the registration number was applied");
ok((out.needsConfirmation ?? []).includes("title_number"),
  "the title number is reported as needing individual confirmation");
ok(!(out.applied ?? []).includes("title_number"), "  and was NOT applied");
ok(!S.tables.vehicle_titles.length, "  nothing reached the Owner-only table");
ok(/still needs individual confirmation/.test(out.message), `  the sentence says so too (${out.message.trim()})`);

console.log("\na value that disagrees with the record is never applied by accepting it");
seedInbox({ plate: "XLK331" });
prop = await readRegistration();
res = await applyFields(prop, ["license_plate"], []);
out = res.results[0];
ok((out.needsConfirmation ?? []).includes("license_plate"),
  "the conflicting plate is reported as needing individual confirmation");
ok(S.tables.vehicles[0].license_plate === "XLK331",
  "  and the plate already on the car is untouched");

console.log("\nconfirmed individually, it is applied");
seedInbox();
prop = await readRegistration();
res = await applyFields(prop, ["license_plate"], ["license_plate"]);
out = res.results[0];
ok((out.applied ?? []).includes("license_plate") && S.tables.vehicles[0].license_plate === "ZZZ999",
  "a ticked plate is written into a blank field");
ok((out.needsConfirmation ?? []).length === 0, "  and nothing is reported as waiting");

console.log("\nthe count the panel shows is the count of fields written");
ok((out.applied ?? []).length === 1, "applied has one entry");
ok(/1 change\(s\) applied/.test(out.message), "  and the sentence agrees with the array");

console.log("\na detail the record already says is reported as already matching");
seedInbox({ plate: "ZZZ999" });
prop = await readRegistration();
res = await applyFields(prop, ["license_plate"], ["license_plate"]);
out = res.results[0];
ok((out.applied ?? []).length === 0, "nothing is applied");
ok((out.unchanged ?? []).includes("license_plate"), "  the plate is reported as already matching the record");
ok(/already matched the record/.test(out.message), "  in the sentence as well");

console.log("\na Manager accepting a title number is told it is Owner-only");
seedInbox();
prop = await readRegistration("mgr-1");
res = await applyFields(prop, ["title_number", "registration_number"], ["title_number"], "mgr-1");
out = res.results[0];
ok(fields(out.rejected).includes("title_number"), "the title number comes back rejected");
ok(/Owner only/i.test((out.rejected ?? [])[0]?.reason ?? ""), "  with the reason");
ok(!S.tables.vehicle_titles.length && S.tables.vehicles[0].title_number == null,
  "  and no title identifier was stored anywhere");
ok(Object.keys((out.rejected ?? [])[0] ?? {}).sort().join() === "field,label,reason",
  "  and the refusal names the field, not the value a Manager may not see");
ok((out.applied ?? []).includes("registration_number"), "  while the rest of the acceptance went through");

// ============================= the plate needs a tick, at the server layer
//
// The Phase 2 review found that the rule "VIN, plate and mileage need
// individual approval" was enforced by the review panel alone: `safe: false`
// kept the plate out of bulk approval, but a request that named the field —
// which the UI cannot produce — applied an extracted plate into a blank
// column with nothing ticked. license_plate is now HIGH_RISK, so the apply
// path refuses it, and the confirmation UI reads the same list.
console.log("\na blank plate is not filled from a document without a tick");
seedInbox();
prop = await readRegistration();
res = await applyFields(prop, ["license_plate"], []);
out = res.results[0];
ok((out.needsConfirmation ?? []).includes("license_plate"),
  "accepting the plate with no confirmation is reported as waiting");
ok(!(out.applied ?? []).includes("license_plate"), "  it is not applied");
ok(S.tables.vehicles[0].license_plate === null, "  and the column is still blank");

console.log("\na confirmation that names another field does not confirm the plate");
seedInbox();
prop = await readRegistration();
res = await applyFields(prop, ["license_plate", "registration_number"], ["registration_number"]);
out = res.results[0];
ok((out.needsConfirmation ?? []).includes("license_plate"),
  "ticking a different field does not tick the plate");
ok(S.tables.vehicles[0].license_plate === null, "  the plate is still blank");
ok(S.tables.vehicles[0].registration_number === "R-000-01",
  "  control: the field that WAS accepted went through, so this is not a refusal of everything");

console.log("\nthe tick has to be for this plate, and then it applies");
seedInbox();
prop = await readRegistration();
res = await applyFields(prop, ["license_plate"], ["license_plate"]);
out = res.results[0];
ok((out.applied ?? []).includes("license_plate") && S.tables.vehicles[0].license_plate === "ZZZ999",
  "a plate confirmed individually is written");
ok((out.needsConfirmation ?? []).length === 0, "  and nothing is left waiting");

console.log("\nan existing plate is never replaced without a tick");
seedInbox({ plate: "XLK331" });
prop = await readRegistration();
res = await applyFields(prop, ["license_plate"], []);
out = res.results[0];
ok((out.needsConfirmation ?? []).includes("license_plate"), "the conflict is reported as waiting");
ok(S.tables.vehicles[0].license_plate === "XLK331", "  and the plate on file stands");

console.log("\na disagreement on an ordinary field also waits for a tick");
// plate_state is normal-risk, so this exercises the conflict branch rather
// than the high-risk one — the two refusals are separate guards.
seedInbox({ state: "GA" });
prop = await readRegistration();
res = await applyFields(prop, ["plate_state"], []);
out = res.results[0];
ok((out.needsConfirmation ?? []).includes("plate_state"),
  "a value that contradicts the record is reported as waiting, whatever its risk");
ok(S.tables.vehicles[0].plate_state === "GA", "  and the record stands");
seedInbox({ state: "GA" });
prop = await readRegistration();
await applyFields(prop, ["plate_state"], ["plate_state"]);
ok(S.tables.vehicles[0].plate_state === "FL", "  with the tick it is applied");

console.log("\nbulk approval cannot reach a plate at all");
seedInbox();
prop = await readRegistration();
const offered = await call(getVehicleSuggestions, { vehicleId: V1 });
const plateRow = (offered.suggestions ?? []).find((x) => x.field === "license_plate");
ok(!!plateRow, "the plate is still offered for review");
ok(plateRow.safe === false, "  but never as a safe field");
ok(plateRow.risk === "high", "  and it is marked high-risk, so Fleet Inbox's Select All Safe skips it");
const bulk = (offered.suggestions ?? []).filter((x) => x.safe).map((x) => x.field);
ok(!bulk.includes("license_plate"), "the bulk set contains no plate");
ok(bulk.length > 0, "  control: there IS a bulk set, so that is not an empty list passing");
res = await applyFields(prop, bulk, []);
out = res.results[0];
ok(!(out.applied ?? []).includes("license_plate"), "applying the whole bulk set writes no plate");
ok(S.tables.vehicles[0].license_plate === null, "  the column is still blank");
ok((out.applied ?? []).length === bulk.length, "  and everything that WAS safe applied");

console.log("\nthe older protections are untouched");
// The reading's VIN matches the car in the other cases, so there is nothing to
// apply. Blank is where the tick decides.
seedInbox({ vin: null });
prop = await readRegistration();
res = await applyFields(prop, ["vin"], []);
out = res.results[0];
ok((out.needsConfirmation ?? []).includes("vin"), "a blank VIN still needs its own tick");
ok(S.tables.vehicles[0].vin === null, "  and is not filled without one");
seedInbox({ vin: null });
prop = await readRegistration();
await applyFields(prop, ["vin"], ["vin"]);
ok(S.tables.vehicles[0].vin === VIN, "  a ticked VIN is applied, so that refusal is the guard");
// And a VIN that disagrees with the car is stronger than a tick: the whole
// apply is refused, which is why the case above has to use a blank one.
seedInbox({ vin: VIN2 });
prop = await readRegistration();
res = await applyFields(prop, ["vin"], ["vin"]);
out = res.results[0];
ok(out.ok === false && /VIN conflict/.test(out.message), "a VIN that contradicts the car refuses the whole apply");
ok(S.tables.vehicles[0].vin === VIN2, "  and nothing on that car moved");
seedInbox();
prop = await readRegistration();
res = await applyFields(prop, ["title_number", "registration_number"], []);
out = res.results[0];
ok((out.needsConfirmation ?? []).includes("title_number"), "the title number still needs its own tick");
ok((out.applied ?? []).includes("registration_number"), "  while an ordinary field still applies");
seedInbox();
prop = await readRegistration("mgr-1");
res = await applyFields(prop, ["title_number"], ["title_number"], "mgr-1");
out = res.results[0];
ok(fields(out.rejected).includes("title_number") && !S.tables.vehicle_titles.length,
  "a Manager's ticked title number is still refused as Owner-only");

// ================================= applying is Manager-and-above, like the drawer
//
// Writing a vehicle column through a document used to be staff-level while
// the profile drawer that writes the SAME columns was Manager-only — the
// document route was the weaker of two doors into one table. The approved
// role model closes that: a Coordinator uploads, classifies, reads the
// results and dismisses proposals; applying is Manager or Owner.
console.log("\napplying an extracted detail is Manager-and-above");
seedInbox();
prop = await readRegistration("mgr-1");
res = await applyFields(prop, ["registration_number"], [], "mgr-1");
ok(S.tables.vehicles[0].registration_number === "R-000-01", "a Manager may apply");
seedInbox();
prop = await readRegistration("own-1");
res = await applyFields(prop, ["registration_number"], [], "own-1");
ok(S.tables.vehicles[0].registration_number === "R-000-01", "so may an Owner");

console.log("\na Coordinator cannot apply, however the request is shaped");
for (const [label, accept, confirm] of [
  ["an ordinary field", ["registration_number"], []],
  ["a plate with a tick", ["license_plate"], ["license_plate"]],
  ["a title number with a tick", ["title_number"], ["title_number"]],
  ["nothing at all", [], []],
]) {
  seedInbox();
  prop = await readRegistration("crd-1");
  let threwC = null;
  try { await applyFields(prop, accept, confirm, "crd-1"); } catch (e) { threwC = e; }
  ok(!!threwC && /Forbidden/.test(String(threwC.message)), `${label} is refused`);
  ok(/Manager-only/.test(String(threwC?.message ?? "")), `  and says why`);
  const car0 = S.tables.vehicles[0];
  ok(car0.registration_number === null && car0.license_plate === null && !S.tables.vehicle_titles.length,
    `  and nothing was written`);
  ok(S.tables.fleet_import_proposals[0].status === "pending",
    `  the proposal is still pending, not claimed`);
}

console.log("\na forged request cannot apply to a vehicle it names directly");
seedInbox();
prop = await readRegistration("crd-1");
let forged = null;
try {
  await call(applyImportDecisions, {
    batchId: BATCH,
    decisions: [
      { proposalId: prop.id, action: "ignore", applyFinance: false, confirmHighRisk: [], acceptFields: [] },
      { proposalId: prop.id, action: "match", vehicleId: V1, acceptFields: ["license_plate"],
        confirmHighRisk: ["license_plate"], applyFinance: false, partial: true },
    ],
  }, "crd-1");
} catch (e) { forged = e; }
ok(!!forged && /Forbidden/.test(String(forged.message)),
  "one apply hidden among dismissals refuses the whole request");
ok(S.tables.vehicles[0].license_plate === null, "  and writes nothing — not even the part that was allowed");

console.log("\nwhat a Coordinator keeps");
seedInbox();
let crdProp = null;
let uploadThrew = null;
try { crdProp = await readRegistration("crd-1"); } catch (e) { uploadThrew = e; }
ok(!uploadThrew && !!crdProp, "a Coordinator can still upload a photo and have it read");
ok(S.tables.documents.length === 1 && S.tables.fleet_import_items.length === 1,
  "  the document and the item exist");
const crdReview = await call(getVehicleSuggestions, { vehicleId: V1 }, "crd-1");
ok((crdReview.suggestions ?? []).length > 0, "and can read what the document says");
ok(crdReview.canOwnership === false, "  without the Owner-only part of it");
ok(S.tables.vehicles[0].license_plate === null, "  and reading changed nothing");
res = await call(applyImportDecisions, {
  batchId: BATCH,
  decisions: [{ proposalId: crdProp.id, action: "ignore", acceptFields: [], confirmHighRisk: [], applyFinance: false }],
}, "crd-1");
ok(res.results[0]?.ok === true && /Ignored/.test(res.results[0].message),
  "and can dismiss a proposal, which is preparation, not a vehicle change");
ok(S.tables.fleet_import_proposals[0].status === "ignored", "  the proposal is marked ignored");
ok(S.tables.vehicles[0].license_plate === null && S.tables.vehicles[0].registration_number === null,
  "  and the vehicle is untouched");

console.log("\nthe drawer that writes the same columns is unchanged");
seedOne();
let plateThrew = null;
try { await post("dmv", { license_plate: "ABC1234" }, "crd-1"); } catch (e) { plateThrew = e; }
ok(!!plateThrew && /Forbidden/.test(String(plateThrew.message)),
  "a Coordinator is still refused by updateVehicleSection");
seedOne();
r = await post("dmv", { license_plate: "MGR7777" }, "mgr-1");
ok(r.ok === true && car().license_plate === "MGR7777", "  and a Manager still writes through it");

console.log("\nbackground extraction is not blocked");
seedInbox();
// readRegistration IS the background path: queue the read, then analyse it.
await readRegistration("crd-1");
ok(S.tables.fleet_import_proposals.length > 0,
  "a Coordinator's upload is still read and proposed, so the queue keeps moving");
ok(S.tables.fleet_import_items[0].status !== "failed", "  the item did not fail");
ok(S.tables.vehicles[0].license_plate === null,
  "  and the reading alone writes nothing to the vehicle");

console.log("\nthe Fleet Inbox screen matches the server");
const FI = readFileSync("src/components/admin/FleetInboxPanel.tsx", "utf8");
ok(/\{isManager && selected\.length > 0 && \(/.test(FI), "the Apply bar is Manager-only");
ok(/\{isManager \? \(\s*\n\s*<button\s*\n\s*onClick=\{selectAllSafe\}/.test(FI), "so is Select All Safe");
ok(/Ready for Manager review/.test(FI), "  with a line saying so instead of a blank space");
ok(/\{p\.kind !== "new" && !done && isManager && \(/.test(FI), "the accept checkboxes are Manager-only");
ok(/\{isManager && p\.kind === "new" && \(/.test(FI), "Create Vehicle is Manager-only");
ok(/\{isManager && p\.kind !== "new" && changes\.some\(\(c\) => c\.safe\)/.test(FI), "so is Accept Safe Changes");
const ignoreBtn = FI.split('active={dec.action === "ignore"}')[0].split("\n").slice(-3).join(" ");
ok(!/isManager/.test(ignoreBtn), "Ignore is NOT gated — dismissing is preparation");
ok(/isManager={tierAllows\(tier, "manager"\)}/.test(readFileSync("src/routes/admin.tsx", "utf8")),
  "and the flag the screen uses is a real tier check");
ok(/canEdit: isManager/.test(readFileSync("src/lib/vehicles.functions.ts", "utf8")),
  "the profile's review panel is gated by the same tier through canEdit");

console.log("\nthe confirmation UI reads the same list");
const INBOXUI = readFileSync("src/components/admin/FleetInboxPanel.tsx", "utf8");
ok(/HIGH_RISK\.has\(c\.field\) \|\| c\.kind === "conflict"/.test(INBOXUI),
  "Fleet Inbox asks for a tick on every HIGH_RISK field, so the plate gets one");
ok(/I confirm changing \{c\.label\}/.test(INBOXUI), "  through the confirmation line it already used");
ok(/c\.risk === "high" && <span[^>]*>HIGH-RISK/.test(INBOXUI), "  and labels it HIGH-RISK");
ok(/\.filter\(\(c\) => c\.safe\)\.map\(\(c\) => c\.field\)/.test(INBOXUI),
  "Select All Safe selects only safe fields, which a plate can no longer be");

console.log("\nthe review panel reports each of those outcomes");
const SUG = readFileSync("src/components/admin/VehicleSuggestions.tsx", "utf8");
ok(/Array\.isArray\(r\.applied\)/.test(SUG), "the panel counts the applied ARRAY, not words in a sentence");
ok(/r\.unchanged/.test(SUG) && /already matched the record/.test(SUG),
  "  it says which details already matched");
ok(/r\.needsConfirmation/.test(SUG) && /still needs individual confirmation/.test(SUG),
  "  which still need a tick");
ok(/r\.rejected/.test(SUG) && /was not saved: /.test(SUG), "  and which were refused, with the reason");
ok(/\(\\d\+\) change/.test(SUG),
  "the old sentence count survives only as a fallback for a server that predates the arrays");

console.log("\nnothing is applied merely by reading the document");
seedInbox();
prop = await readRegistration();
const before = JSON.stringify(S.tables.vehicles[0]);
await call(getVehicleSuggestions, { vehicleId: V1 });
ok(JSON.stringify(S.tables.vehicles[0]) === before, "reviewing changes nothing");

// =========================================================================
// 3. FLEET-WIDE READINESS
// =========================================================================
console.log("\nthe bands are the same two rules as everywhere else");
const READY = { year: 2013, make: "Ford", model: "Fusion", vin: VIN, weekly_rate: 350 };
ok(L.readinessBand(READY, true) === "listing_ready", "ready + a published photo is Listing Ready");
ok(L.readinessBand(READY, false) === "rental_ready", "ready without one is Rental Ready");
ok(L.readinessBand({ ...READY, weekly_rate: 0 }, true) === "not_ready", "$0 is not a rate, photo or no photo");
ok(L.readinessBand({ ...READY, weekly_rate: null }, false) === "not_ready", "no rate is Needs Setup");
ok(L.readinessBand({ ...READY, vin: "NOTAVIN" }, false) === "not_ready", "an invalid VIN is Needs Setup");
ok(L.readinessBand({ ...READY, make: "" }, false) === "not_ready", "no make is Needs Setup");
ok(L.readinessGaps({ ...READY, weekly_rate: null }, false).join() === "Weekly Rate",
  "the gaps name what is missing");
ok(L.readinessGaps(READY, false).join() === "Published Listing Photo",
  "a car short only of a photo says so");
ok(L.readinessGaps(READY, true).length === 0, "and a Listing Ready car has no gaps");
ok(L.isReadinessFilter("not_ready") && !L.isReadinessFilter("nearly"), "only the real bands are filters");

function seedFleet() {
  S.experience = null;
  S.tables = {
    user_roles: ROLES,
    vehicles: [
      // listing ready
      { id: V1, unit_number: "SYN-1", year: 2013, make: "Ford", model: "Fusion", vin: VIN, weekly_rate: 350, status: "available", body_type: "sedan", photos: [], partner_id: null, archived_at: null },
      // rental ready, no published photo
      { id: V2, unit_number: "SYN-2", year: 2016, make: "Toyota", model: "Camry", vin: VIN2, weekly_rate: 400, status: "available", body_type: "sedan", photos: [], partner_id: null, archived_at: null },
      // not ready: no rate
      { id: V3, unit_number: "SYN-3", year: 2019, make: "Honda", model: "Civic", vin: "1HGCM82633A004354", weekly_rate: null, status: "onboarding", body_type: "sedan", photos: [], partner_id: null, archived_at: null },
      // archived, and not ready — must not be counted in the normal view
      { id: V4, unit_number: "SYN-4", year: 2011, make: "Kia", model: "Rio", vin: null, weekly_rate: null, status: "archived", body_type: "sedan", photos: [], partner_id: null, archived_at: new Date().toISOString() },
    ],
    vehicle_media: [
      { id: "m1", vehicle_id: V1, published: true, kind: "original", storage_path: `${V1}/a.jpg`, storage_bucket: "vehicle-photos" },
      // Uploaded but NOT published: a photo nobody approved is not a listing.
      { id: "m2", vehicle_id: V2, published: false, kind: "original", storage_path: `${V2}/a.jpg`, storage_bucket: "vehicle-photos" },
    ],
    rentals: [],
  };
  S.log = []; S.defaults = {};
}
const listing = (over = {}) =>
  call(listVehicles, { q: "", status: "all", body: "all", partner: "all", sort: "unit", ready: "all", page: 1, pageSize: 50, ...over }, "crd-1");

console.log("\nthe chips count the fleet");
seedFleet();
let res3 = await listing();
ok(res3.readinessCounts.listing_ready === 1, `1 Listing Ready (got ${res3.readinessCounts.listing_ready})`);
ok(res3.readinessCounts.rental_ready === 1, `1 Rental Ready (got ${res3.readinessCounts.rental_ready})`);
ok(res3.readinessCounts.not_ready === 1, `1 Needs Setup (got ${res3.readinessCounts.not_ready})`);
ok(res3.rows.length === 3, "the archived car is out of the normal view");
ok(!Object.values(res3.readinessCounts).some((n) => n > 3), "  and out of the counts");

console.log("\nan unapproved photo does not make a car listing ready");
ok(res3.rows.find((v) => v.id === V2).readiness === "rental_ready",
  "SYN-2 has an unpublished photo and stays Rental Ready");
ok(res3.rows.find((v) => v.id === V2).readinessGaps.join() === "Published Listing Photo",
  "  and the list says exactly what it needs");
ok(res3.rows.find((v) => v.id === V1).readiness === "listing_ready", "control: the published one IS Listing Ready");

console.log("\nthe counts do not change as you page");
seedFleet();
const p1 = await listing({ pageSize: 1, page: 1 });
const p2 = await listing({ pageSize: 1, page: 2 });
ok(p1.rows.length === 1 && p2.rows.length === 1, "one row per page");
ok(p1.total === 3 && p2.total === 3, `the total is the fleet, not the page (${p1.total})`);
ok(JSON.stringify(p1.readinessCounts) === JSON.stringify(res3.readinessCounts),
  "page 1 reports the same fleet-wide counts");
ok(JSON.stringify(p2.readinessCounts) === JSON.stringify(res3.readinessCounts),
  "  and so does page 2");
ok(p1.rows[0].id !== p2.rows[0].id, "and the two pages are different cars");

console.log("\nfiltering by a band returns that band, and pages correctly");
seedFleet();
for (const band of ["listing_ready", "rental_ready", "not_ready"]) {
  const f = await listing({ ready: band });
  ok(f.rows.length === 1 && f.rows[0].readiness === band, `${band}: one matching car`);
  ok(f.total === 1, `  and a total of 1, so the pager agrees (${f.total})`);
  ok(JSON.stringify(f.readinessCounts) === JSON.stringify(res3.readinessCounts),
    `  while the chips still count the whole fleet`);
}

console.log("\na band with nothing in it says so instead of showing everything");
seedFleet();
S.tables.vehicles = S.tables.vehicles.filter((v) => v.id !== V1);
let empty = await listing({ ready: "listing_ready" });
ok(empty.rows.length === 0 && empty.total === 0, "no rows, and no claim of any");
ok(empty.readinessCounts.listing_ready === 0, "  the count agrees");
ok(Array.isArray(empty.statuses) && empty.statuses.length > 0, "  and the other filters still work");

console.log("\nthe readiness filter composes with the others");
seedFleet();
const composed = await listing({ ready: "not_ready", status: "available" });
ok(composed.rows.length === 0, "SYN-3 is Needs Setup but not Available, so nothing matches");
ok(composed.readinessCounts.not_ready === 0,
  "and the chips count the filtered scope, not the whole table");

console.log("\nnonsense in the URL is not a filter");
seedFleet();
const junk = await listing({ ready: "../../etc" });
ok(junk.rows.length === 3, "an unknown band falls back to every car, not to none");

console.log("\nthe list still carries no money or title columns");
const LISTSRC = readFileSync("src/lib/vehicles-list.functions.ts", "utf8");
const cols = /const LIST_COLUMNS =\s*\n?\s*"([^"]+)"/.exec(LISTSRC)[1].split(",");
for (const forbidden of ["purchase_price", "payoff_amount", "lienholder", "title_number", "title_status", "internal_notes"]) {
  ok(!cols.includes(forbidden), `the list does not select ${forbidden}`);
}
seedFleet();
res3 = await listing();
const keys = Object.keys(res3.rows[0]);
for (const forbidden of ["purchase_price", "title_number", "internal_notes"]) {
  ok(!keys.includes(forbidden), `and no row carries ${forbidden}`);
}
ok(keys.includes("readiness") && keys.includes("readinessGaps"), "every row carries its readiness");

console.log("\nreadiness is reported, never enforced");
ok(res3.rows.find((v) => v.id === V3).status === "onboarding",
  "a Needs Setup car keeps the status a human gave it");
ok(!S.log.some((e) => e.op === "update" && e.table === "vehicles"),
  "and listing the fleet wrote nothing at all");

// =========================================================================
// 1. THE OPTIONAL PAPERWORK STEP (contract; the browser suite drives it)
// =========================================================================
console.log("\nAdd Vehicle offers paperwork after the car is saved");
const ADD = readFileSync("src/components/admin/AddVehicleDialog.tsx", "utf8");
ok(/type Mode =[^;]*"docs"/.test(ADD), "the dialog has a paperwork step");
ok(/<VehicleDocuments/.test(ADD), "  which renders the SAME panel as the Paperwork tab");
ok(!/<input[^>]*type="file"/.test(ADD), "  and introduces no second file input");
ok(/function afterCreate\(id: string, label: string\)/.test(ADD), "a created car moves to that step");
ok(/setMode\("docs"\)/.test(ADD), "  rather than closing the dialog");
ok(/Skip For Now/.test(ADD), "Skip is offered in those words");
ok(/const finish = \(\) => \{\s*\n\s*if \(created\) onCreated\(created\.id\);/.test(ADD),
  "and leaving it still reports the created vehicle to the list");
ok(/is saved\./.test(ADD), "the step says the car is already saved");
const QUICK = readFileSync("src/components/admin/QuickAddVehicle.tsx", "utf8");
ok(/onCreated\(res\.id, label\)/.test(QUICK), "Quick Add hands over the car it just made");
ok(/registerVehicleMedia/.test(QUICK), "  and its optional photo path is untouched");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} blocker(s)` : "\nall Phase 2 checks pass");
process.exit(fail ? 1 : 0);
