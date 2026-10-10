/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A PRE-DELIVERY INSPECTION IS FILED AGAINST THE CAR YOU WERE LOOKING AT.
 *   A TITLE DOCUMENT, A TITLE RECORD AND A TITLE STATUS ARE THREE FACTS.
 *   GROUPING THE READINESS CHECKLIST MUST NOT MAKE ANYTHING LESS BLOCKING.
 *
 * The audit found three things in the live fleet:
 *
 *   RR-009 has a title scan linked, and the DMV tab said "Not On File" while
 *   the Fleet Profile checklist ticked Title as done — on the same screen,
 *   because one read a document slot and the other read a column that is
 *   nulled for everyone outside the Owner view.
 *
 *   The readiness "Open Inspections" button navigated with no vehicle id, and
 *   the Start Inspection form defaulted to whichever car sorted first. Click
 *   Fix on RR-007, inspect RR-001. The server never checked the id either.
 *
 *   Every one of the nine vehicles reports Not Ready, because none has an
 *   inspection and none has a registration expiry. A checklist that is red
 *   for the whole fleet is not a checklist.
 *
 * The third is addressed by grouping, NOT by re-grading, and the largest
 * section below is the one that pins every status to what it was — because
 * the easy way to make a checklist look better is to quietly downgrade it.
 *
 * Real modules, fake Supabase, synthetic vehicles. No network, no paid call,
 * no real record.
 *
 * Run: node scripts/vehicle-readiness-phase1.test.mjs  (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".readiness-build";
const VIN = "1HGCM82633A004352";          // synthetic, valid check digit
const V1 = "aaaaaaaa-0000-4000-8000-000000000001";
const V2 = "aaaaaaaa-0000-4000-8000-000000000002";
const GONE = "aaaaaaaa-0000-4000-8000-0000000000ff";
const TEMPLATE = "bbbbbbbb-0000-4000-8000-00000000000a";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });
writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
writeFileSync(`${OUT}/stub/react-start-server.js`, `export const getRequest = () => ({ headers: new Map() });`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub/audit.js`, `export const logAudit = async () => {};`);

const alias = [
  "--alias:@=./src",
  `--alias:@tanstack/react-start/server=./${OUT}/stub/react-start-server.js`,
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/supabase.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit.js`,
  `--alias:@/lib/audit.server=./${OUT}/stub/audit.js`,
];
const build = (entry, out) =>
  execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/${out}`, ...alias],
    { stdio: ["ignore", "ignore", "inherit"] });

build("src/lib/vehicle-readiness.ts", "rules.mjs");
build("src/lib/inspections.functions.ts", "insp.mjs");

const R = await import(`../${OUT}/rules.mjs`);
const { startInspection } = await import(`../${OUT}/insp.mjs`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });
/**
 * isStaff() uses the REQUEST-scoped client, not the admin one, so the context
 * needs its own minimal stand-in. It answers one question — is this user staff
 * — and the tests here are about vehicle identity, not about that gate.
 */
const staffClient = {
  from: () => ({ select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [{ role: "admin" }] }) }) }) }) }),
};
const call = (fn, data) => fn({ data: fn._validate ? fn._validate(data) : data, context: { userId: "staff-1", supabase: staffClient } });

// ============================================== 1. the right vehicle, server side
function seedInspections({ archived = false } = {}) {
  S.tables = {
    user_roles: [{ user_id: "staff-1", role: "admin" }],
    vehicles: [
      { id: V1, unit_number: "SYN-1", archived_at: archived ? new Date().toISOString() : null },
      { id: V2, unit_number: "SYN-2", archived_at: null },
    ],
    inspection_templates: [{ id: TEMPLATE, inspection_type: "pre_delivery", is_active: true }],
    inspections: [],
  };
  S.log = []; S.defaults = {};
}
const started = () => S.tables.inspections;

console.log("\nan inspection is filed against the vehicle that was named");
seedInspections();
let r = await call(startInspection, { vehicleId: V2, templateId: TEMPLATE, odometer: 1000 });
ok(!!r?.id, "the inspection starts");
ok(started().length === 1 && started()[0].vehicle_id === V2,
  "  against SYN-2, the vehicle asked for — not the first in the list");

console.log("\nthe server refuses a vehicle that is not there");
seedInspections();
let threw = null;
try { await call(startInspection, { vehicleId: GONE, templateId: TEMPLATE }); } catch (e) { threw = e; }
ok(!!threw && /no longer exists/i.test(String(threw.message)), "a well-formed id for a missing vehicle is refused");
ok(started().length === 0, "  and no inspection was created against nothing");

console.log("\nan id that is not an id never reaches the handler");
for (const bad of ["", "RR-007", "../../etc", "1234"]) {
  let t = null;
  try { await call(startInspection, { vehicleId: bad, templateId: TEMPLATE }); } catch (e) { t = e; }
  ok(!!t, `"${bad}" is rejected by validation`);
}
ok(started().length === 0, "  and nothing was started by any of them");

console.log("\nan archived vehicle cannot be inspected");
seedInspections({ archived: true });
threw = null;
try { await call(startInspection, { vehicleId: V1, templateId: TEMPLATE }); } catch (e) { threw = e; }
ok(!!threw && /archived/i.test(String(threw.message)), "refused, and says why");
ok(started().length === 0, "  nothing started");

console.log("\nswitching vehicles switches the record, not just the form");
seedInspections();
await call(startInspection, { vehicleId: V1, templateId: TEMPLATE });
await call(startInspection, { vehicleId: V2, templateId: TEMPLATE });
ok(started().length === 2, "two inspections");
ok(started()[0].vehicle_id === V1 && started()[1].vehicle_id === V2,
  "  one against each vehicle, in the order they were asked for");

console.log("\nthe Fix button carries the vehicle (the navigation that caused this)");
const profileSrc = readFileSync("src/components/admin/VehicleProfile.tsx", "utf8");
ok(/search: \{ tab: f\.tab, id: v\.id \}/.test(profileSrc),
  "readiness navigates to the admin tab WITH the vehicle id");
const panelSrc = readFileSync("src/components/admin/InspectionsPanel.tsx", "utf8");
ok(/initialVehicleId \?\? vehicles\[0\]\?\.id/.test(panelSrc),
  "the form prefers the vehicle it was sent, and only then falls back");
ok(/vehicles\.some\(\(v\) => v\.id === fromVehicleId\)/.test(panelSrc),
  "an id that matches no vehicle in the list is ignored, not guessed at");
// Found only by driving it in a browser: the navigation DID carry the id and
// the router's own normaliser stripped it straight back out, because the
// inspections tab was not listed as an owner of `id`. Source-matching the
// navigate() call passed the whole time.
const adminSrc = readFileSync("src/routes/admin.tsx", "utf8");
ok(/id: \["drivers", "vehicles", "inspections"\]/.test(adminSrc),
  "the inspections tab is allowed to keep a vehicle id in its URL");

// ====================================================== 2. three title facts
const baseVehicle = {
  id: V1, vin: VIN, year: 2013, make: "Ford", model: "Fusion", weekly_rate: 350,
  license_plate: null, plate_expires_on: null, registration_expires_on: null,
  insurance_expires_on: null, current_odometer: null, color: null, gps_status: null,
};
const ctx = (over = {}) => ({ docKinds: [], maintenanceCount: 0, ...over });
const titleItem = (c) => R.profileItems(baseVehicle, c).find((i) => i.key === "title");

console.log("\na title document and a title record are different facts");
ok(R.titleOnFile({ documentOnFile: true, metadataRecorded: false }, []), "a scan on file counts");
ok(R.titleOnFile({ documentOnFile: false, metadataRecorded: true }, []), "recorded details count");
ok(!R.titleOnFile({ documentOnFile: false, metadataRecorded: false }, []), "neither does not");
ok(titleItem(ctx({ title: { documentOnFile: true, metadataRecorded: false } })).done === true,
  "the Fleet Profile ticks Title when the scan is linked — RR-009's case");

console.log("\nand an Owner and a Manager get the same answer");
// The Owner view carries title_number; every other view has it nulled. That
// asymmetry is exactly what made the same vehicle score differently.
const ownerView = { ...baseVehicle, title_number: "124645628", title_status: "clean" };
const managerView = { ...baseVehicle, title_number: null, title_status: "on_file" };
const facts = { documentOnFile: true, metadataRecorded: true };
ok(R.profileItems(ownerView, ctx({ title: facts })).find((i) => i.key === "title").done ===
   R.profileItems(managerView, ctx({ title: facts })).find((i) => i.key === "title").done,
  "Owner and Manager agree on whether the title is handled");
ok(R.percent(R.profileItems(ownerView, ctx({ title: facts }))) ===
   R.percent(R.profileItems(managerView, ctx({ title: facts }))),
  "  so the completeness percentage is the same for both");

console.log("\na document on file is never a verified title");
ok(titleItem(ctx({ title: { documentOnFile: true, metadataRecorded: false } })).label === "Title",
  "the checklist says Title, not Title Verified");
ok(!/verified/i.test(JSON.stringify(R.profileItems(baseVehicle, ctx({ title: { documentOnFile: true, metadataRecorded: false } })))),
  "  and nothing in the checklist claims verification from a document");
const dmv = profileSrc.slice(profileSrc.indexOf('title="Title & Identity"'), profileSrc.indexOf('title="Title & Identity"') + 1400);
ok(/Title Document/.test(dmv) && /Title Details/.test(dmv), "the DMV tab shows both facts separately");
ok(/p\.canSeeFinance && \(/.test(dmv), "  and the number and status stay behind the Owner gate");

// ============================================ 3. classification without weakening
const FACTS = { lastPreDeliveryPassedAt: null, schedules: [], openIssues: [], openIncidents: [], hasActiveRental: false };
const statusOf = (checks, key) => checks.find((c) => c.key === key)?.status;

console.log("\nevery check is classified");
let checks = R.vehicleReadinessChecks(baseVehicle, FACTS, []);
ok(checks.every((c) => !!c.category), "no check is left uncategorised");
ok(new Set(checks.map((c) => c.category)).size >= 2, "  and they are not all in one bucket");
ok(statusOf(checks, "identity") !== undefined && checks.find((c) => c.key === "identity").category === "operational",
  "identity is operational");
ok(checks.find((c) => c.key === "registration").category === "compliance", "registration is compliance");
ok(R.listingPhotoCheck(0, 3).category === "listing", "listing photos are listing");

console.log("\nTHE ONE THAT MATTERS: grouping changed no status");
// A car with nothing recorded — the state all nine live vehicles are in.
ok(statusOf(checks, "registration") === "not_ready", "a missing registration expiry still blocks");
ok(statusOf(checks, "insurance") === "not_ready", "a missing insurance expiry still blocks");
ok(statusOf(checks, "inspection") === "not_ready", "no passed pre-delivery inspection still blocks");
ok(statusOf(checks, "plate") === "attention", "a missing plate is still attention, not blocking");
ok(R.overallReadiness(checks) === "not_ready", "and the vehicle overall is still Not Ready");

// A document on file but no date — RR-004 after its registration was filed.
checks = R.vehicleReadinessChecks(baseVehicle, FACTS, ["registration"]);
ok(statusOf(checks, "registration") === "not_ready",
  "a registration document WITHOUT a date is still blocking — a scan is not a date");
ok(/no expiration date recorded/i.test(checks.find((c) => c.key === "registration").reason),
  "  and the reason says so");

// Expired beats missing.
const expired = { ...baseVehicle, registration_expires_on: "2020-01-01", insurance_expires_on: "2020-01-01" };
checks = R.vehicleReadinessChecks(expired, FACTS, ["registration", "insurance_card"]);
ok(statusOf(checks, "registration") === "not_ready", "an expired registration still blocks");
ok(statusOf(checks, "insurance") === "not_ready", "an expired insurance still blocks");

// Everything in order.
const good = { ...baseVehicle, registration_expires_on: "2030-01-01", insurance_expires_on: "2030-01-01", license_plate: "SYN404", plate_expires_on: "2030-01-01" };
checks = R.vehicleReadinessChecks(good, { ...FACTS, lastPreDeliveryPassedAt: new Date().toISOString().slice(0, 10) }, ["registration", "insurance_card"]);
ok(R.overallReadiness(checks) === "ready", "control: a complete vehicle still reads Ready, so the above are real");
ok(R.readinessByCategory(checks).every((g) => g.status === "ready"), "  and every category is ready");

console.log("\nthe category rollup never contradicts the overall verdict");
checks = R.vehicleReadinessChecks(baseVehicle, FACTS, []);
const groups = R.readinessByCategory(checks);
ok(groups.length >= 2, "the checklist splits into groups");
ok(groups.every((g) => g.checks.length > 0), "  no empty group is rendered");
ok(groups.some((g) => g.status === "not_ready"), "  at least one group carries the blocking status");
ok(R.overallReadiness(checks) === "not_ready", "  and the overall verdict is unchanged by grouping");
ok(checks.length === groups.reduce((n, g) => n + g.checks.length, 0), "  every check appears exactly once");

console.log("\nthe enforced gate is untouched");
ok(R.isRentalReady(baseVehicle) === true,
  "Rental Ready is still identity + VIN + rate — documents never granted it and still do not");
ok(R.isRentalReady({ ...baseVehicle, weekly_rate: 0 }) === false, "  and $0 still fails it");
ok(R.rentalReadyItems(baseVehicle).length === 3, "  still exactly three requirements");
const rules = readFileSync("src/lib/vehicle-readiness.ts", "utf8");
ok(!/listing_photo[\s\S]{0,200}rentalReady/i.test(rules), "a published photo still has no bearing on renting");

console.log("\nthe unused parameter is gone, and nothing was relying on it");
ok(R.vehicleReadinessChecks.length === 3,
  "vehicleReadinessChecks takes (v, facts, docKinds) before its defaulted `today` — the photo count is gone");
const callers = execFileSync("grep", ["-rn", "vehicleReadinessChecks(", "src"], { encoding: "utf8" })
  .split("\n").filter((l) => l && !l.includes("export function"));
ok(callers.length === 1, `exactly one caller remains (${callers.length})`);
ok(!/publishedPhotos/.test(callers[0] ?? ""), "  and it no longer passes a published-photo count");
ok(/listingPhotoCheck\(p\.counts\.publishedPhotos/.test(profileSrc),
  "published photos still drive the listing check, which is where they belong");

console.log("\nnothing here writes to a vehicle");
const writes = S.log.filter((e) => e.table === "vehicles" && e.op !== "select");
ok(writes.length === 0, "no vehicle row was written by any of these paths");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
