/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A SECOND BUTTON IS NOT A SECOND TRANSACTION. endRental REMAINS THE ONLY
 *     CALLER OF end_rental_tx, AND BOOKINGS REACHES IT THROUGH endRental.
 *   AN INSPECTION OF A CAR THAT IS OUT BELONGS TO THE RENTAL IT IS OUT ON.
 *   A COORDINATOR MAY SEE THAT THE CAR WAS CRASHED, NEVER WHAT IT COST.
 *   AN UNAUTHORIZED ACTION LEAVES NO TRACE — IT NEVER REACHES THE TRANSACTION.
 *   CONDITION EVIDENCE STAYS WITH THE VEHICLE IT IS EVIDENCE FOR.
 *
 * R1 adds actions to a screen that previously only read. The danger in that is
 * not the buttons, it is the temptation to reimplement what they do. So the
 * assertions here are mostly about what is ABSENT: no second write path, no
 * money where it was withheld, no transaction reached by somebody refused.
 *
 * The inspection back-fill is the one real repair. rental_id on an inspection
 * was only ever what the caller passed, and the Start Inspection form never
 * passed one — so every inspection and condition photo taken during a live
 * rental was stored with rental_id NULL, invisible from the booking it was
 * evidence for. These tests pin the fix from both entry points.
 *
 * Real modules, fake Supabase, synthetic rentals. Database functions are
 * recorded, not executed: a path that never reaches one leaves no entry.
 *
 * Run: node scripts/bookings-actions.test.mjs   (npm run test:bookings-actions)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".bookings-actions-build";
const R1 = "11111111-0000-4000-8000-000000000001"; // active
const R2 = "11111111-0000-4000-8000-000000000002"; // closed
const A1 = "22222222-0000-4000-8000-000000000001";
const V1 = "33333333-0000-4000-8000-000000000001"; // on R1
const V2 = "33333333-0000-4000-8000-000000000002"; // free
const U1 = "44444444-0000-4000-8000-000000000001";
const TPL_OUT = "55555555-0000-4000-8000-00000000000a";
const TPL_IN = "55555555-0000-4000-8000-00000000000b";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });
writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
writeFileSync(`${OUT}/stub/react-start-server.js`, `
export const getRequest = () => ({ headers: new Map() });
export const getRequestHeader = () => null;
`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub/audit-server.js`, `
export const logAudit = async (actor, entry) => { (globalThis.__fakeSb.audit ??= []).push(entry); };
`);

const alias = [
  "--alias:@=./src",
  `--alias:@tanstack/react-start/server=./${OUT}/stub/react-start-server.js`,
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/supabase.js`,
  `--alias:@/lib/audit.server=./${OUT}/stub/audit-server.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit-server.js`,
];
const build = (entry, out) =>
  execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/${out}`, ...alias],
    { stdio: ["ignore", "ignore", "inherit"] });

build("src/lib/bookings.functions.ts", "bookings.mjs");
build("src/lib/inspections.functions.ts", "inspections.mjs");
build("src/lib/rentals.functions.ts", "rentals.mjs");

const { getBooking } = await import(`../${OUT}/bookings.mjs`);
const { startInspection, listConditionMedia, confirmConditionUpload } = await import(`../${OUT}/inspections.mjs`);
const { endRental } = await import(`../${OUT}/rentals.mjs`);
const SB = await import(`../${OUT}/stub/supabase.js`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const ROLES = [
  { user_id: "own-1", role: "admin" },
  { user_id: "mgr-1", role: "team" },
  { user_id: "crd-1", role: "coordinator" },
  { user_id: U1, role: "driver" },
];
const call = (fn, data, userId = "mgr-1") =>
  fn({
    data: fn._validate ? fn._validate(data) : data,
    context: { userId, supabase: SB.supabaseAdmin, claims: { email: `${userId}@example.com` } },
  });

function seed() {
  S.tables = {
    user_roles: ROLES,
    applications: [{ id: A1, user_id: U1, full_name: "Dana Rivers", email: "dana@example.com", phone: "8135550111", status: "active" }],
    vehicles: [
      { id: V1, unit_number: "RR-001", year: 2013, make: "Ford", model: "Fusion", license_plate: "ABC1234", vin: "1HGCM82633A004352", color: "Blue", status: "rented", archived_at: null },
      { id: V2, unit_number: "RR-002", year: 2016, make: "Toyota", model: "Camry", license_plate: "XYZ7788", vin: "1HGCM82633A004353", color: "Grey", status: "available", archived_at: null },
    ],
    rentals: [
      { id: R1, status: "active", start_date: "2026-09-01", end_date: null, created_at: "2026-09-01T10:00:00Z",
        vehicle_id: V1, driver_id: U1, application_id: A1, weekly_rate: 350, deposit_amount: 300, deposit_held: true,
        deposit_status: "held", payment_status: "current", pickup_reading_id: "re-1", return_reading_id: null },
      { id: R2, status: "closed", start_date: "2026-01-01", end_date: "2026-04-01", created_at: "2026-01-01T10:00:00Z",
        vehicle_id: V2, driver_id: U1, application_id: A1, weekly_rate: 325, deposit_amount: 300, deposit_held: false,
        deposit_status: "refunded", payment_status: "current", pickup_reading_id: null, return_reading_id: null },
    ],
    inspection_templates: [
      { id: TPL_OUT, name: "Pre-Delivery", inspection_type: "pre_delivery", is_active: true, is_default: true },
      { id: TPL_IN, name: "Return", inspection_type: "return", is_active: true, is_default: true },
    ],
    inspection_template_items: [
      { id: "ti-1", template_id: TPL_OUT, section: "Exterior", label: "Front bumper", requires_photo: true, is_critical: false, sort_order: 1 },
      { id: "ti-2", template_id: TPL_IN, section: "Exterior", label: "Front bumper", requires_photo: true, is_critical: false, sort_order: 1 },
    ],
    inspections: [],
    inspection_items: [],
    condition_media: [],
    // Two incidents and two service records, one of each on the OTHER rental,
    // so a leak across rentals cannot pass.
    incidents: [
      { id: "inc-1", rental_id: R1, vehicle_id: V1, incident_type: "accident", occurred_at: "2026-09-20T14:00:00Z",
        reported_at: "2026-09-20T15:00:00Z", severity: "moderate", status: "open", at_fault: "renter", drivable: false,
        claim_number: "CLM-9", description: "Rear-ended at a light",
        estimated_cost: 2400, actual_cost: 2650, driver_responsible_amount: 1000, deductible: 1000, insurance_payout: 1650 },
      { id: "inc-2", rental_id: R2, vehicle_id: V2, incident_type: "damage", occurred_at: "2026-02-02T14:00:00Z",
        reported_at: "2026-02-02T15:00:00Z", severity: "minor", status: "closed", at_fault: "unknown", drivable: true,
        claim_number: null, description: "Kerbed wheel",
        estimated_cost: 300, actual_cost: 280, driver_responsible_amount: 280, deductible: 0, insurance_payout: 0 },
    ],
    maintenance_records: [
      { id: "mr-1", rental_id: R1, vehicle_id: V1, item: "Oil change", category: "oil", status: "completed",
        priority: "routine", due_date: null, performed_on: "2026-09-15", odometer: 43000, vendor_name_raw: "Tampa Lube", total_cost: 89.5 },
      { id: "mr-2", rental_id: R2, vehicle_id: V2, item: "Brake pads", category: "brakes", status: "completed",
        priority: "routine", due_date: null, performed_on: "2026-02-10", odometer: 25000, vendor_name_raw: "Bay Brakes", total_cost: 410 },
    ],
    odometer_readings: [{ id: "re-1", rental_id: R1, vehicle_id: V1, mileage: 41000, status: "valid", observed_on: "2026-09-01" }],
    agreements: [], payments: [], toll_charges: [], audit_log: [],
  };
  S.log = []; S.audit = []; S.rpcs = []; S.defaults = {};
  S.rpcResults = { end_rental_tx: { data: "closed", error: null } };
}

// ====================================== the inspection belongs to the rental
console.log("\\nan inspection of a car that is OUT belongs to the rental it is out on");
seed();
let r = await call(startInspection, { vehicleId: V1, templateId: TPL_IN }, "mgr-1");
let insp = S.tables.inspections.find((x) => x.id === r.id);
ok(!!insp, "the inspection was created");
ok(insp.rental_id === R1,
  `with no rentalId passed, the server resolved it from the car (${String(insp.rental_id).slice(0, 8)})`);
ok(insp.inspection_type === "return", "and took its type from the checklist, not from the caller");

console.log("\\na car that is NOT out records no rental, and does not guess one");
seed();
r = await call(startInspection, { vehicleId: V2, templateId: TPL_OUT }, "mgr-1");
insp = S.tables.inspections.find((x) => x.id === r.id);
ok(insp.rental_id === null,
  "a pre-delivery inspection before any rental exists stays unattached — which is correct");

console.log("\\nan explicitly named rental always wins");
seed();
r = await call(startInspection, { vehicleId: V1, templateId: TPL_IN, rentalId: R1 }, "mgr-1");
insp = S.tables.inspections.find((x) => x.id === r.id);
ok(insp.rental_id === R1, "Bookings names the rental, and the server keeps it");

console.log("\\nand the evidence is findable from the booking afterwards");
seed();
r = await call(startInspection, { vehicleId: V1, templateId: TPL_IN }, "mgr-1");
await call(confirmConditionUpload, {
  vehicleId: V1, rentalId: R1, inspectionId: r.id, phase: "checkin", angle: "front",
  path: `${V1}/checkin-front.jpg`, fileName: "checkin-front.jpg", mimeType: "image/jpeg", sizeBytes: 1024,
}, "mgr-1");
const found = await call(listConditionMedia, { vehicleId: V1, rentalId: R1 }, "mgr-1");
ok(found.length === 1, `the condition photo is returned for this rental (${found.length})`);
ok(found[0].vehicle_id === V1, "filed against the right vehicle");
ok(found[0].rental_id === R1, "  and the right rental");
const otherRental = await call(listConditionMedia, { vehicleId: V1, rentalId: R2 }, "mgr-1");
ok(otherRental.length === 0, "and it does not appear under a different rental");

console.log("\\nthe booking's own Inspections tab now finds it");
const afterInsp = await call(getBooking, { rentalId: R1 }, "mgr-1");
ok(afterInsp.inspections.length === 1, "the inspection shows on the booking");
ok(afterInsp.counts.conditionPhotos === 1, "and so does its photo");
ok(afterInsp.inspections[0].photoCount === 1, "counted against the inspection that took it");

console.log("\\nwho may start one");
for (const [who, why] of [[U1, "a driver"], ["nobody", "somebody with no role"]]) {
  seed();
  let t = null;
  try { await call(startInspection, { vehicleId: V1, templateId: TPL_IN }, who); } catch (e) { t = e; }
  ok(!!t && /Forbidden/.test(String(t.message)), `${why} is refused`);
  ok(S.tables.inspections.length === 0, `  and no inspection row was written`);
}
// A Coordinator may now record a handoff — canInspect() admits them, and the
// whole boundary is pinned in scripts/inspection-permissions.test.mjs. Here it
// matters only because the Bookings buttons are offered on that basis.
seed();
const crdStarted = await call(startInspection, { vehicleId: V1, templateId: TPL_IN }, "crd-1");
ok(!!crdStarted?.id, "a Coordinator CAN start a handoff inspection");
ok(S.tables.inspections.find((x) => x.id === crdStarted.id)?.rental_id === R1,
  "  and it is filed against the rental the car is out on");
let threw = null;

// ====================================== incidents and service on the booking
console.log("\\nwhat happened is on the booking; what it cost depends on who asks");
seed();
const mgr = await call(getBooking, { rentalId: R1 }, "mgr-1");
ok(mgr.incidents.length === 1 && mgr.incidents[0].id === "inc-1",
  "this rental's incident is listed, and only this rental's");
ok(mgr.incidents[0].type === "accident" && mgr.incidents[0].drivable === false,
  "with what happened and whether the car could be driven");
ok(mgr.incidents[0].claimNumber === "CLM-9", "and its claim number");
ok(mgr.incidents[0].actualCost === 2650 && mgr.incidents[0].driverResponsible === 1000,
  "a Manager sees the real costs");
ok(mgr.maintenance.length === 1 && mgr.maintenance[0].id === "mr-1",
  "this rental's service record is listed, and only this rental's");
ok(mgr.maintenance[0].item === "Oil change" && mgr.maintenance[0].odometer === 43000,
  "with the work and the mileage it was done at");
ok(mgr.maintenance[0].totalCost === 89.5, "and a Manager sees the bill");
ok(mgr.counts.incidents === 1 && mgr.counts.maintenance === 1, "the counts agree");

console.log("\\na Coordinator sees the event and never the amount");
const crd = await call(getBooking, { rentalId: R1 }, "crd-1");
ok(crd.incidents.length === 1, "the incident is still theirs to see — they may be arranging the tow");
ok(crd.incidents[0].type === "accident" && crd.incidents[0].drivable === false,
  "  including that the car is not drivable");
for (const k of ["estimatedCost", "actualCost", "driverResponsible"]) {
  ok(!(k in crd.incidents[0]), `${k} is ABSENT from the incident, not null or hidden`);
}
ok(crd.maintenance.length === 1 && crd.maintenance[0].item === "Oil change",
  "the service record is theirs to see");
ok(!("totalCost" in crd.maintenance[0]), "totalCost is ABSENT from the service record");
const crdText = JSON.stringify(crd);
for (const amount of ["2650", "2400", "1650", "89.5"]) {
  ok(!crdText.includes(amount), `no ${amount} leaks anywhere in their payload`);
}
ok(crd.canManage === false, "and the answer says they may not run the rental actions");
ok(mgr.canManage === true, "  control: a Manager may");

// ====================================== the one transaction, reached one way
console.log("\\nEnd Rental reaches end_rental_tx, once, through the existing path");
seed();
const res = await call(endRental, { rentalId: R1, endDate: "2026-10-11", vehicleStatus: "maintenance", returnMileage: 48000 }, "mgr-1");
ok(res.ok === true, "the Manager's call succeeded");
ok(S.rpcs.length === 1, `exactly one database function was called (${S.rpcs.length})`);
ok(S.rpcs[0].name === "end_rental_tx", `and it was end_rental_tx (${S.rpcs[0].name})`);
ok(S.rpcs[0].args._rental_id === R1, "for this rental");
ok(S.rpcs[0].args._vehicle_status === "maintenance",
  "carrying the destination the operator chose — Bookings can send a car to the shop");
ok(S.rpcs[0].args._return_miles === 48000, "and the return mileage as one observation");
ok(!S.log.some((w) => w.table === "rentals"), "no rental row was written outside the transaction");
ok(!S.log.some((w) => w.table === "vehicles"), "and no vehicle row either");
ok((S.audit ?? []).some((a) => a.action === "rental.ended"), "the end was audited");

console.log("\\na Coordinator never reaches it");
seed();
threw = null;
try { await call(endRental, { rentalId: R1, vehicleStatus: "available" }, "crd-1"); } catch (e) { threw = e; }
ok(!!threw && /Forbidden/.test(String(threw.message)), "endRental refuses a Coordinator");
ok(S.rpcs.length === 0, "and the transaction was never called — refused before, not during");
ok((S.audit ?? []).length === 0, "nothing was audited for a call that never happened");

console.log("\\nnor does a driver, or anybody with no role");
for (const who of [U1, "nobody"]) {
  seed();
  threw = null;
  try { await call(endRental, { rentalId: R1, vehicleStatus: "available" }, who); } catch (e) { threw = e; }
  ok(!!threw && /Forbidden/.test(String(threw.message)), `${who} is refused`);
  ok(S.rpcs.length === 0, `  and reached no transaction`);
}

// ====================================== reading changes nothing
console.log("\\nreading a booking still writes nothing, actions or not");
seed();
await call(getBooking, { rentalId: R1 }, "mgr-1");
await call(getBooking, { rentalId: R1 }, "mgr-1");
await call(getBooking, { rentalId: R2 }, "mgr-1");
ok(S.log.length === 0, `no write was issued by any read (${S.log.length})`);
ok(S.rpcs.length === 0, "and no database function was called");
ok((S.audit ?? []).length === 0, "and nothing was audited");

// ====================================== no second transaction path
console.log("\\nthe actions are buttons on existing paths, not new paths");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ACTIONS = strip(readFileSync("src/components/admin/BookingActions.tsx", "utf8"));
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "activate_rental_tx", "end_rental_tx", "supabaseAdmin"]) {
  ok(!ACTIONS.includes(forbidden), `BookingActions.tsx contains no ${forbidden.replace(/[().]/g, "")}`);
}
for (const reused of ["endRental", "startInspection", "DepositDialog", "InspectionRunner"]) {
  ok(ACTIONS.includes(reused), `it reuses the existing ${reused}`);
}
const BOOKFN = strip(readFileSync("src/lib/bookings.functions.ts", "utf8"));
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
  ok(!BOOKFN.includes(forbidden), `bookings.functions.ts is still a reader: no ${forbidden.replace(/[().]/g, "")}`);
}
const RENTALFN = readFileSync("src/lib/rentals.functions.ts", "utf8");
ok((RENTALFN.match(/end_rental_tx/g) ?? []).length >= 1, "end_rental_tx is still named in rentals.functions.ts");
// Comments name the transaction on purpose, to say why a file does not call
// it. So count CALLERS: an actual rpc("end_rental_tx") invocation.
let callers = [];
try {
  callers = execFileSync("grep", ["-rlE", 'rpc\\("end_rental_tx"', "src/"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
} catch { /* grep exits 1 when nothing matches */ }
ok(callers.length === 1 && callers[0] === "src/lib/rentals.functions.ts",
  `exactly one module in src/ CALLS end_rental_tx (${callers.join(", ") || "none"})`);
let activators = [];
try {
  activators = execFileSync("grep", ["-rlE", 'rpc\\("activate_rental_tx"', "src/"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
} catch { /* nothing matched */ }
ok(activators.length === 1 && activators[0] === "src/lib/rentals.functions.ts",
  `and exactly one calls activate_rental_tx (${activators.join(", ") || "none"})`);
ok(/tierAllows\(actor\.tier, "manager"\)/.test(BOOKFN), "the booking read still gates money on Manager");
ok(/requireManager/.test(RENTALFN), "and endRental still requires a Manager");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\\n${fail} blocker(s)` : "\\nall Bookings R1 action checks pass");
process.exit(fail ? 1 : 0);
