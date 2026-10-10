/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A PHOTOGRAPH IS EVIDENCE OF WHAT IS ON THE CAR, AND NOTHING ELSE.
 *   NOTHING A CAMERA SAW IS WRITTEN WITHOUT A PERSON SAYING SO.
 *
 * Reading vehicle photos reuses the Fleet Inbox pipeline whole — one reader,
 * one queue, one matcher, one review panel, one apply path. What is new is a
 * doorway and a set of limits, and the limits are what can hurt someone:
 *
 *   - a photo must never produce a registration expiry, insurance, ownership
 *     or finance fact, however confidently a model offers one;
 *   - a photo must never outrank the registration card;
 *   - no photo-derived value may ride in on "Approve Safe Fields";
 *   - the plate and the VIN need an individual tick even then;
 *   - an unpublished photo must stay unreachable to anyone storage refuses;
 *   - reading the same photo twice must not cost twice or duplicate the review.
 *
 * These run the REAL modules — the pure rules, the real readVehiclePhoto
 * handler, the real analyzeItemCore, the real getVehicleSuggestions — against
 * a fake Supabase and a STUBBED reader. No network, no paid call, no real
 * photo, synthetic VINs belonging to no vehicle in any fleet.
 *
 * Run: node scripts/vehicle-photo-analysis.test.mjs  (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".photoread-build";
const VIN = "1HGCM82633A004352";          // synthetic, valid check digit
const VEHICLE = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-00000000000f";
const MEDIA = "eeeeeeee-0000-4000-8000-000000000001";
const BATCH = "bbbbbbbb-0000-4000-8000-000000000001";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });

writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/audit.js`, `
const S = (globalThis.__fakeSb ??= {});
export const logAudit = async (actor, entry) => { (S.audits ??= []).push(entry); };
`);
writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub/roles.server.js`, `
const S = (globalThis.__fakeSb ??= {});
S.tier ??= "owner";
export const requireStaff = async (userId) => ({ userId, tier: S.tier, role: S.tier === "owner" ? "admin" : S.tier });
export const requireManager = async (userId) => { if (S.tier === "coordinator") throw new Error("Forbidden"); return { userId, tier: S.tier, role: "admin" }; };
export const requireOwner = async (userId) => { if (S.tier !== "owner") throw new Error("Forbidden"); return { userId, tier: S.tier, role: "admin" }; };
`);
writeFileSync(`${OUT}/stub/experience.server.js`, `
const S = (globalThis.__fakeSb ??= {});
export const ownerView = (actor) => (S.ownerView ?? (actor?.tier === "owner"));
`);
writeFileSync(`${OUT}/stub/reader.js`, `
const S = (globalThis.__fakeSb ??= {});
export const READER_MAX_BYTES = 20971520;
export async function readDocument() {
  S.readerCalls = (S.readerCalls ?? 0) + 1;
  if (S.readerFails) return { ok: false, error: "The document reader returned an error (500).", status: 500 };
  if (S.readerGarbage) return { ok: true, text: "not json at all" };
  return { ok: true, text: JSON.stringify(S.readerPayload) };
}
export function parseModelJson(t) {
  const c = t.trim().replace(/^\\\`\\\`\\\`(?:json)?/i, "").replace(/\\\`\\\`\\\`$/, "").trim();
  const a = c.indexOf("{"), b = c.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? c.slice(a, b + 1) : c);
}
`);

const alias = [
  "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/supabase.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub/roles.server.js`,
  `--alias:@/lib/experience.server=./${OUT}/stub/experience.server.js`,
  `--alias:@/lib/document-reader.server=./${OUT}/stub/reader.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit.js`,
  `--alias:@/lib/audit.server=./${OUT}/stub/audit.js`,
];
const build = (entry, out) =>
  execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/${out}`, ...alias],
    { stdio: ["ignore", "ignore", "inherit"] });

build("src/lib/fleet-inbox.ts", "rules.mjs");
build("src/lib/vehicle-photo-analysis.functions.ts", "photo.mjs");
build("src/lib/fleet-inbox.functions.ts", "inbox.mjs");

const rules = await import(`../${OUT}/rules.mjs`);
const { readVehiclePhoto } = await import(`../${OUT}/photo.mjs`);
const { getVehicleSuggestions, analyzeInboxItem } = await import(`../${OUT}/inbox.mjs`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const call = (fn, data) => fn({ data: fn._validate ? fn._validate(data) : data, context: { userId: "staff-1" } });

// ======================================================= the rules alone
console.log("\na photograph ranks below the paperwork it might contradict");
ok(rules.authorityOf("license_plate", "registration") === 100, "a registration card is the authority on the plate");
ok(rules.authorityOf("license_plate", "condition_photo") === 35, "  a photo of the car is worth much less");
ok(rules.authorityOf("license_plate", "condition_photo") < rules.authorityOf("license_plate", "insurance_card"),
  "  and ranks below even an insurance card");
ok(rules.authorityOf("color", "condition_photo") < rules.authorityOf("color", "registration"),
  "the same holds for colour");

console.log("\nexcept where the camera really is the best witness");
ok(rules.authorityOf("vin", "vin_photo") === 100, "a photographed VIN plate is authoritative for the VIN");
ok(rules.authorityOf("current_odometer", "odometer_photo") === 100, "a dashboard photo is authoritative for mileage");
ok(rules.authorityOf("current_odometer", "condition_photo") === 10, "  but a mileage glimpsed in a condition photo is not");

console.log("\nuploads made from a vehicle are reviewed by a person, never autofilled");
ok(rules.isStaffReviewChannel("vehicle_profile"), "the Documents tab is a staff-review channel");
ok(rules.isStaffReviewChannel("vehicle_photo"), "so is the Photos tab");
ok(!rules.isStaffReviewChannel("fleet_inbox"), "Fleet Inbox is not");
ok(!rules.isStaffReviewChannel(null), "an unlabelled batch is not (Fleet Inbox is the documented default)");

const blankVehicle = () => ({
  id: VEHICLE, vin: VIN, unit_number: "TEST-1", year: 2013, make: "Ford", model: "Fusion",
  color: null, body_type: null, trim: null, license_plate: null, plate_state: null, title_number: null,
  registration_number: null, registration_state: null, registration_expires_on: null,
  insurance_carrier: null, insurance_policy_number: null, insurance_expires_on: null, current_odometer: null,
});
// What a model might return from an exterior photo if nobody stopped it.
const OVERREACH = {
  vin: { value: VIN, raw: VIN, confidence: "high" },
  license_plate: { value: "ZZZ999", raw: "ZZZ999", confidence: "high" },
  plate_state: { value: "FL", raw: "FL", confidence: "high" },
  color: { value: "BLU", raw: "BLU", confidence: "high" },
  body_type: { value: "sedan", raw: "4D", confidence: "medium" },
  registration_expires_on: { value: "2027-06-30", raw: "2027-06-30", confidence: "high" },
  insurance_carrier: { value: "Mobilitas", raw: "Mobilitas", confidence: "high" },
  insurance_expires_on: { value: "2027-07-01", raw: "2027-07-01", confidence: "high" },
  title_number: { value: "124645628", raw: "124645628", confidence: "high" },
  // Finance facts go to a separate Owner-only table, not to `changes`, so they
  // must be in the fixture or the "filed no finance facts" assertion below is
  // vacuously true — it was, until this line was added.
  legal_owner: { value: "REAL RENTALS LLC", raw: "REAL RENTALS LLC", confidence: "high" },
  lienholder: { value: "Some Bank NA", raw: "SOME BANK NA", confidence: "high" },
  purchase_price: { value: "7400", raw: "$7,400.00", confidence: "high" },
};

console.log("\na photo never produces a fact only an office can know");
for (const cls of ["condition_photo", "vin_photo", "odometer_photo", "damage_photo"]) {
  const d = rules.buildProposal({ page: 1, fields: OVERREACH }, cls, [blankVehicle()], {});
  const got = d.changes.map((c) => c.field);
  ok(!got.includes("registration_expires_on"), `${cls}: refuses a registration expiry`);
  ok(!got.includes("insurance_carrier") && !got.includes("insurance_expires_on"), `  ${cls}: refuses insurance`);
  ok(!got.includes("title_number"), `  ${cls}: refuses the title number`);
}
const fromDoc = rules.buildProposal({ page: 1, fields: OVERREACH }, "registration", [blankVehicle()], {});
ok(fromDoc.changes.some((c) => c.field === "registration_expires_on"),
  "control: the same fields DO come through from a registration card, so the refusals above are the photo rule");

console.log("\nwhat a photo may legitimately offer still comes through");
const photo = rules.buildProposal({ page: 1, fields: OVERREACH }, "condition_photo", [blankVehicle()], {});
const fields = photo.changes.map((c) => c.field);
ok(fields.includes("license_plate"), "the plate it could actually see");
ok(fields.includes("color"), "the colour");
ok(fields.includes("body_type"), "the body type");
ok(photo.matchVehicleId === VEHICLE, "and it is matched to the right car by VIN");

console.log("\na photo never contradicts a document that is already on file");
const documented = { ...blankVehicle(), license_plate: "XLK331", color: "Blue" };
const prov = { [VEHICLE]: { license_plate: rules.authorityOf("license_plate", "registration"), color: rules.authorityOf("color", "registration") } };
const clash = rules.buildProposal({ page: 1, fields: OVERREACH }, "condition_photo", [documented], prov);
const plate = clash.changes.find((c) => c.field === "license_plate");
ok(plate && plate.kind === "conflict", "a different plate is reported as a conflict, never an update");
ok(plate && plate.safe === false, "  and is never safe to apply in bulk");
ok(clash.kind === "conflict", "  so the whole proposal is flagged for a person");

// ================================================== the doorway: one photo
function seed({ tier = "owner", mediaKind = "original", mediaVehicle = VEHICLE, mime = "image/jpeg" } = {}) {
  S.tier = tier;
  S.ownerView = tier === "owner";
  S.defaults = { fleet_import_proposals: { status: "pending" }, fleet_import_items: { status: "uploaded" } };
  S.tables = {
    app_settings: [{ key: "safe_autofill", value: { enabled: true, daily_cap: 50, paused_at: null, paused_reason: null } }],
    vehicles: [{ ...blankVehicle(), archived_at: null }, { ...blankVehicle(), id: OTHER, vin: "1HGCM82633A004353", unit_number: "TEST-2", archived_at: null }],
    vehicle_titles: [], vehicle_field_provenance: [], vehicle_autofill_events: [],
    vehicle_media: [{ id: MEDIA, vehicle_id: mediaVehicle, kind: mediaKind, storage_bucket: "vehicle-photos",
      storage_path: `${mediaVehicle}/1791596541357-n4wzeu.jpg`, file_name: "front.jpg", mime_type: mime, size_bytes: 2048 }],
    fleet_import_batches: [{ id: BATCH, source_channel: "vehicle_photo", status: "uploading" }],
    fleet_import_items: [], fleet_import_proposals: [], fleet_import_finance_facts: [],
    fleet_inbox_jobs: [], fleet_service_transactions: [], documents: [], document_vehicle_links: [], audit_log: [],
  };
  S.files = { [`vehicle-photos/${mediaVehicle}/1791596541357-n4wzeu.jpg`]: [0xff, 0xd8, 0xff, 0xe0] };
  S.log = []; S.audits = []; S.readerCalls = 0; S.readerFails = false; S.readerGarbage = false;
  S.readerPayload = {
    documentClass: "condition_photo", classConfidence: "high", pageCount: 1, shared: {},
    vehicles: [{ page: 1, fields: OVERREACH }], warnings: [],
  };
}
const docs = () => S.tables.documents;
const items = () => S.tables.fleet_import_items;

console.log("\nqueueing a photo for reading");
seed();
let r = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA, intendedClass: "condition_photo" });
ok(r.ok && !!r.itemId, "the photo is queued");
ok(docs().length === 1, "  one document record was created");
ok(docs()[0].storage_bucket === "vehicle-photos", "  pointing at the private photo bucket");
ok(docs()[0].storage_path === `${VEHICLE}/1791596541357-n4wzeu.jpg`, "  at the photograph's existing path");
ok(!Object.keys(S.files).some((k) => k.startsWith("vehicle-docs/")), "  and the bytes were NOT copied into the document vault");
ok(items().length === 1 && items()[0].doc_class === "condition_photo", "  an inbox item is waiting, classed as a photo");
ok(S.tables.fleet_inbox_jobs.length === 1, "  and the ordinary background queue picks it up — no second pipeline");
ok((S.audits ?? []).some((a) => a.action === "vehicle.photo_read_requested"), "  the request is in the audit history");

console.log("\nreading the same photograph twice costs nothing and clutters nothing");
r = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA, intendedClass: "condition_photo" });
ok(r.ok && r.duplicate === true, "the second request reports it was already read");
ok(docs().length === 1, "  no second document record");
ok(items().length === 1, "  no second inbox item");
ok(S.tables.fleet_inbox_jobs.length === 1, "  and no second reading was queued");

console.log("\nwhat the doorway refuses");
seed({ mediaVehicle: OTHER });
r = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA });
ok(!r.ok && /different vehicle/i.test(r.error ?? ""), "a photo belonging to another vehicle");
ok(items().length === 0, "  and nothing was queued");

seed({ mediaKind: "ai_enhanced" });
r = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA });
ok(!r.ok && /not evidence/i.test(r.error ?? ""), "a retouched copy — only originals are read");
ok(items().length === 0, "  and nothing was queued");

seed({ mime: "application/pdf" });
r = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA });
ok(!r.ok && /can't be read/i.test(r.error ?? ""), "a file that is not an image");

seed();
S.tables.vehicle_media = [];
r = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA });
ok(!r.ok && /no longer exists/i.test(r.error ?? ""), "a photo that has been deleted");

seed();
S.files = {};
r = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA });
ok(!r.ok && /storage/i.test(r.error ?? ""), "a record whose bytes are missing — reported, not silently skipped");
ok(items().length === 0, "  and nothing was queued for a file that could not be read");

console.log("\nthe Photos tab cannot be used to file Owner-only paperwork");
seed({ tier: "team" });
let threw = null;
try { await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA, intendedClass: "title" }); }
catch (e) { threw = e; }
ok(!!threw, "declaring a photo to be a title is refused outright");
ok(items().length === 0, "  and nothing was queued");
for (const cls of ["purchase_document", "loan_document", "payoff_statement", "registration"]) {
  let t = null;
  try { await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA, intendedClass: cls }); } catch (e) { t = e; }
  ok(!!t, `  so is declaring it a ${cls.replace(/_/g, " ")}`);
}

// ============================================ end to end, into the review panel
/** Queue the photo, read it, and ask the review panel what it would offer. */
async function readAndReview({ tier = "owner", docClass = "condition_photo" } = {}) {
  seed({ tier });
  S.readerPayload.documentClass = docClass;
  const q = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA, intendedClass: "condition_photo" });
  await call(analyzeInboxItem, { itemId: q.itemId });
  return await call(getVehicleSuggestions, { vehicleId: VEHICLE });
}

console.log("\nwhat the review panel offers after reading a photo");
let rev = await readAndReview();
const byField = Object.fromEntries((rev.suggestions ?? []).map((x) => [x.field, x]));
ok((rev.suggestions ?? []).length > 0, "there is something to review");
ok((rev.suggestions ?? []).every((x) => x.safe === false),
  "NOTHING read from a photo is safe — Approve Safe Fields can never sweep one in");
ok(!!byField.license_plate && byField.license_plate.safe === false, "the plate needs its own tick");
ok(!!byField.color && byField.color.safe === false, "  and so does the colour, which paperwork would have made safe");
ok((rev.suggestions ?? []).every((x) => x.fromPhoto === true), "every row is marked as read from a photo");
ok((rev.suggestions ?? []).every((x) => typeof x.photoPath === "string" && x.photoPath.startsWith(VEHICLE + "/")),
  "  and carries the photograph's path so the reviewer can look at it");
ok((rev.suggestions ?? []).every((x) => !/^https?:/i.test(String(x.photoPath))),
  "  as a storage path, never a signed URL — the browser still fetches it as staff");
for (const f of ["registration_expires_on", "insurance_carrier", "insurance_expires_on", "title_number"]) {
  ok(!byField[f], `the panel offers no ${f.replace(/_/g, " ")} from a photo`);
}
ok(S.tables.fleet_import_finance_facts.length === 0, "and a photo filed no finance facts at all");
rev = await readAndReview({ docClass: "bill_of_sale" });
ok(S.tables.fleet_import_finance_facts.length > 0,
  "  control: the same reading as paperwork DOES file them, so that refusal is the photo rule");

console.log("\ncontrol: the same reading, classified as a registration card, behaves differently");
rev = await readAndReview({ docClass: "registration" });
const docByField = Object.fromEntries((rev.suggestions ?? []).map((x) => [x.field, x]));
ok(!!docByField.registration_expires_on, "paperwork DOES yield a registration expiry");
ok((rev.suggestions ?? []).some((x) => x.safe === true),
  "  and some of its fields ARE safe — so 'never safe' above is the photo rule, not an empty list");
ok(docByField.license_plate && docByField.license_plate.safe === false,
  "  though the plate still needs an individual tick even from paperwork");

console.log("\nOwner-only values never reach a Manager or a Coordinator");
for (const tier of ["team", "coordinator"]) {
  rev = await readAndReview({ tier, docClass: "registration" });
  const f = Object.fromEntries((rev.suggestions ?? []).concat(rev.conflicts ?? []).map((x) => [x.field, x]));
  ok(!f.title_number, `${tier}: no title number in the review panel`);
  ok(rev.canOwnership === false, `  ${tier}: and the panel knows not to offer ownership data`);
}
rev = await readAndReview({ tier: "owner", docClass: "registration" });
ok((rev.suggestions ?? []).concat(rev.conflicts ?? []).some((x) => x.field === "title_number"),
  "control: an Owner DOES see the title number, so the two refusals above mean something");

console.log("\nan unreadable photograph fails loudly and writes nothing");
seed();
S.readerFails = true;
let q = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA, intendedClass: "condition_photo" });
let a = await call(analyzeInboxItem, { itemId: q.itemId });
ok(a.ok === false, "the analysis reports failure");
ok(items()[0].status === "failed" && !!items()[0].error, "  the item is marked failed, with a reason");
ok(S.tables.fleet_import_proposals.length === 0, "  and nothing was proposed from a reading that never happened");

seed();
S.readerGarbage = true;
q = await call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: MEDIA, intendedClass: "condition_photo" });
a = await call(analyzeInboxItem, { itemId: q.itemId });
ok(a.ok === false, "a reply that is not JSON is a failure, not a silent empty result");
ok(S.tables.fleet_import_proposals.length === 0, "  and proposes nothing");

console.log("\nreading a photo never writes to the vehicle by itself");
rev = await readAndReview();
const v = S.tables.vehicles.find((x) => x.id === VEHICLE);
ok(v.license_plate === null && v.color === null && v.body_type === null,
  "the vehicle is untouched until a person approves a field");
ok(S.tables.vehicle_autofill_events.length === 0, "  and Safe Autofill did not run for the Photos channel");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
