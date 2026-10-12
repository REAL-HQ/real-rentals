/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A COORDINATOR MAY RECORD A HANDOFF. THEY MAY NOT DESTROY THE EVIDENCE.
 *   isStaff() STILL MEANS OWNER-OR-MANAGER. NOTHING ELSE MOVED.
 *   A DRIVER REACHES ONLY THE CAR THEY ARE RENTING.
 *   A FORGED VEHICLE OR RENTAL ID YIELDS NOTHING — NOT AN ERROR THAT LEAKS.
 *   AN UPLOAD IS PINNED TO ONE VEHICLE'S FOLDER, NEVER THE WHOLE BUCKET.
 *   NO LICENCE NUMBER, IDENTITY DOCUMENT, AGREEMENT PDF OR AMOUNT IS REACHABLE.
 *
 * R1 needed a Coordinator to be able to meet a renter in a car park and record
 * the handoff. The gate in inspections.functions.ts was isStaff(), admin/team
 * only, and it guards nine endpoints — one of which DELETES condition photos,
 * the single thing on this screen that can make a damage claim unprovable.
 *
 * So the helper was not widened. isStaff() keeps its exact boundary and keeps
 * exactly one caller (deleteConditionMedia); the eight operational endpoints
 * ask a new canInspect() instead. These tests pin both halves: what the
 * Coordinator gained, and everything they did not.
 *
 * Real modules, fake Supabase, synthetic rentals. No network, no real record.
 *
 * Run: node scripts/inspection-permissions.test.mjs   (npm run test:insp-perms)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".insp-perms-build";
const R1 = "11111111-0000-4000-8000-000000000001"; // active, on V1
const R2 = "11111111-0000-4000-8000-000000000002"; // active, on V2, OTHER driver
const A1 = "22222222-0000-4000-8000-000000000001";
const A2 = "22222222-0000-4000-8000-000000000002";
const V1 = "33333333-0000-4000-8000-000000000001";
const V2 = "33333333-0000-4000-8000-000000000002";
const U1 = "44444444-0000-4000-8000-000000000001"; // drives V1
const U2 = "44444444-0000-4000-8000-000000000002"; // drives V2
const TPL_OUT = "55555555-0000-4000-8000-00000000000a";
const TPL_IN = "55555555-0000-4000-8000-00000000000b";
const CM1 = "66666666-0000-4000-8000-000000000001";
const CM2 = "66666666-0000-4000-8000-000000000002";
/** Well-formed, belongs to nothing. */
const FORGED_V = "99999999-0000-4000-8000-0000000000v1".replace("v", "a");
const FORGED_R = "99999999-0000-4000-8000-0000000000r1".replace("r", "b");

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

build("src/lib/inspections.functions.ts", "inspections.mjs");

const I = await import(`../${OUT}/inspections.mjs`);
const SB = await import(`../${OUT}/stub/supabase.js`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const ROLES = [
  { user_id: "own-1", role: "admin" },
  { user_id: "mgr-1", role: "team" },
  { user_id: "crd-1", role: "coordinator" },
  { user_id: U1, role: "driver" },
  { user_id: U2, role: "driver" },
];
const call = (fn, data, userId) =>
  fn({
    data: fn._validate ? fn._validate(data) : data,
    context: { userId, supabase: SB.supabaseAdmin, claims: { email: `${userId}@example.com` } },
  });
const refused = async (fn, data, userId) => {
  try { await call(fn, data, userId); return null; } catch (e) { return String(e.message); }
};

function seed() {
  S.tables = {
    user_roles: ROLES,
    applications: [
      { id: A1, user_id: U1, full_name: "Dana Rivers", email: "dana@example.com",
        license_number: "R123456789012", license_state: "FL", dob: "1990-02-03", status: "active" },
      { id: A2, user_id: U2, full_name: "Omar Vance", email: "omar@example.com",
        license_number: "V987654321098", license_state: "FL", dob: "1988-07-11", status: "active" },
    ],
    vehicles: [
      { id: V1, unit_number: "RR-001", year: 2013, make: "Ford", model: "Fusion", license_plate: "ABC1234",
        vin: "1HGCM82633A004352", status: "rented", archived_at: null, gps_device_id: "GPS-1", purchase_price: 6200 },
      { id: V2, unit_number: "RR-002", year: 2016, make: "Toyota", model: "Camry", license_plate: "XYZ7788",
        vin: "1HGCM82633A004353", status: "rented", archived_at: null, gps_device_id: "GPS-2", purchase_price: 8100 },
    ],
    rentals: [
      { id: R1, status: "active", start_date: "2026-09-01", end_date: null, vehicle_id: V1, driver_id: U1,
        application_id: A1, weekly_rate: 350, deposit_amount: 300 },
      { id: R2, status: "active", start_date: "2026-09-05", end_date: null, vehicle_id: V2, driver_id: U2,
        application_id: A2, weekly_rate: 400, deposit_amount: 300 },
    ],
    inspection_templates: [
      { id: TPL_OUT, name: "Pre-Delivery", inspection_type: "pre_delivery", is_active: true, is_default: true },
      { id: TPL_IN, name: "Return", inspection_type: "return", is_active: true, is_default: true },
    ],
    inspection_template_items: [
      { id: "ti-1", template_id: TPL_IN, section: "Exterior", label: "Front bumper", requires_photo: true, is_critical: false, sort_order: 1 },
      { id: "ti-2", template_id: TPL_IN, section: "Safety", label: "Brakes", requires_photo: false, is_critical: true, sort_order: 2 },
    ],
    inspections: [],
    inspection_items: [],
    // One photo already on each car, so a cross-vehicle leak cannot pass.
    condition_media: [
      { id: CM1, vehicle_id: V1, rental_id: R1, inspection_id: null, phase: "checkout", angle: "front",
        media_type: "photo", storage_bucket: "condition-media", storage_path: `${V1}/a.jpg`,
        captured_by_role: "staff", created_at: "2026-09-01T10:00:00Z", caption: null },
      { id: CM2, vehicle_id: V2, rental_id: R2, inspection_id: null, phase: "checkout", angle: "front",
        media_type: "photo", storage_bucket: "condition-media", storage_path: `${V2}/b.jpg`,
        captured_by_role: "staff", created_at: "2026-09-05T10:00:00Z", caption: null },
    ],
    documents: [
      { id: "doc-1", driver_id: A1, kind: "drivers_license", category: "identity",
        storage_bucket: "driver-docs", storage_path: "a1/license.jpg", visibility: ["staff"] },
    ],
    agreements: [
      { id: "ag-1", rental_id: R1, application_id: A1, status: "signed", document_id: "doc-ag-1",
        archive_status: "archived", title: "Rental Agreement" },
    ],
    odometer_readings: [], audit_log: [],
  };
  S.files = { [`condition-media/${V1}/a.jpg`]: [1, 2, 3] };
  S.log = []; S.audit = []; S.rpcs = []; S.defaults = {};
}

const TIERS = [["own-1", "an Owner"], ["mgr-1", "a Manager"], ["crd-1", "a Coordinator"]];

// =============================================== 1. the handoff, for all three
console.log("\\nOwner, Manager and Coordinator can all record a handoff");
for (const [who, label] of TIERS) {
  seed();
  const started = await call(I.startInspection, { vehicleId: V1, templateId: TPL_IN }, who);
  ok(!!started?.id, `${label} can START a Check-In`);
  const row = S.tables.inspections.find((x) => x.id === started.id);
  ok(row?.rental_id === R1, `  and it is filed against the rental the car is out on`);
  ok(row?.vehicle_id === V1, "  against the right vehicle");

  const detail = await call(I.getInspection, { id: started.id }, who);
  ok(detail.items.length === 2, `${label} can READ the checklist they are running`);

  const item = S.tables.inspection_items.find((x) => x.inspection_id === started.id);
  await call(I.setInspectionItem, { itemId: item.id, result: "pass", notes: "fine" }, who);
  ok(S.tables.inspection_items.find((x) => x.id === item.id).result === "pass",
    `${label} can RECORD a checklist result`);

  await call(I.updateInspection, { id: started.id, odometer: 48000, fuelLevel: "half", notes: "clean" }, who);
  const patched = S.tables.inspections.find((x) => x.id === started.id);
  ok(patched.odometer === 48000 && patched.fuel_level === "half",
    `${label} can RECORD mileage and fuel`);

  const up = await call(I.createConditionUploadUrl, { vehicleId: V1, fileName: "front.jpg", mimeType: "image/jpeg" }, who);
  ok(up.path.startsWith(`${V1}/`), `${label} gets an upload path pinned to THIS vehicle's folder`);
  ok(up.bucket === "condition-media", "  in the private condition bucket");
  await call(I.confirmConditionUpload, {
    vehicleId: V1, rentalId: R1, inspectionId: started.id, phase: "checkin", angle: "front",
    path: up.path, fileName: "front.jpg", mimeType: "image/jpeg", sizeBytes: 100,
  }, who);
  const mine = S.tables.condition_media.find((m) => m.storage_path === up.path);
  ok(!!mine, `${label} can UPLOAD a condition photo`);
  ok(mine.captured_by_role === "staff", "  recorded as staff-captured, not driver-captured");

  const seen = await call(I.listConditionMedia, { vehicleId: V1, rentalId: R1 }, who);
  ok(seen.length === 2, `${label} can VIEW this rental's condition photos (${seen.length})`);
  ok(seen.every((m) => m.vehicle_id === V1), "  and only this vehicle's");
  ok(seen.every((m) => String(m.url ?? "").startsWith("signed://")),
    "  served as short-lived signed URLs, never a public path");

  // The remaining critical item is still pending, so completing refuses —
  // which is the existing rule, unchanged for every tier.
  const incomplete = await call(I.completeInspection, { id: started.id }, who);
  ok(incomplete.ok === false && incomplete.incomplete.length === 1,
    `${label} cannot sign off a half-finished checklist`);
  const crit = S.tables.inspection_items.find((x) => x.inspection_id === started.id && x.is_critical);
  await call(I.setInspectionItem, { itemId: crit.id, result: "pass" }, who);
  const done = await call(I.completeInspection, { id: started.id }, who);
  ok(done.ok === true && done.status === "passed", `${label} can COMPLETE it`);
}

// =============================================== 2. what a Coordinator did NOT get
console.log("\\na Coordinator still cannot destroy the evidence");
seed();
let msg = await refused(I.deleteConditionMedia, { id: CM1 }, "crd-1");
ok(msg === "Forbidden", `deleteConditionMedia refuses a Coordinator (${msg})`);
ok(S.tables.condition_media.some((m) => m.id === CM1), "  and the photo is still there");
ok(!!S.files[`condition-media/${V1}/a.jpg`], "  and so are its bytes");

console.log("\\ncontrol: a Manager and an Owner still can, so the refusal is the boundary");
for (const [who, label] of [["mgr-1", "a Manager"], ["own-1", "an Owner"]]) {
  seed();
  await call(I.deleteConditionMedia, { id: CM1 }, who);
  ok(!S.tables.condition_media.some((m) => m.id === CM1), `${label} can delete a condition photo`);
  ok(!S.files[`condition-media/${V1}/a.jpg`], "  and the bytes go with it");
}

console.log("\\nisStaff() keeps exactly one caller, and it is the delete");
const SRC = readFileSync("src/lib/inspections.functions.ts", "utf8");
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const isStaffCalls = (code.match(/await isStaff\(context/g) ?? []).length;
const canInspectCalls = (code.match(/await canInspect\(context/g) ?? []).length;
ok(isStaffCalls === 1, `isStaff() is called once (${isStaffCalls})`);
ok(canInspectCalls === 8, `canInspect() is called eight times (${canInspectCalls})`);
ok(/tierAllows\(await staffTier\(supabase, userId\), "manager"\)/.test(code),
  "isStaff() still means Owner-or-Manager");
ok(/tierAllows\(await staffTier\(supabase, userId\), "coordinator"\)/.test(code),
  "canInspect() means Coordinator-and-above");
const delBlock = code.slice(code.indexOf("export const deleteConditionMedia"), code.indexOf("export const startInspection"));
ok(/await isStaff\(context/.test(delBlock) && !/canInspect/.test(delBlock),
  "and the one isStaff() call is inside deleteConditionMedia");

console.log("\\nnothing sensitive is reachable from this module at all");
for (const forbidden of ["license_number", "from(\"documents\")", "from(\"agreements\")", "from(\"payments\")",
  "from(\"toll_charges\")", "deposit", "weekly_rate", "activate_rental_tx", "end_rental_tx"]) {
  ok(!code.includes(forbidden), `inspections.functions.ts never touches ${forbidden}`);
}
const insp = await call(I.getInspection, { id: (await (async () => {
  seed();
  return (await call(I.startInspection, { vehicleId: V1, templateId: TPL_IN }, "crd-1")).id;
})()) }, "crd-1");
const payload = JSON.stringify(insp);
for (const leak of ["R123456789012", "1990-02-03", "GPS-1", "6200", "signature_ip", "user_agent", "350"]) {
  ok(!payload.includes(leak), `the Coordinator's inspection payload has no ${leak}`);
}

// =============================================== 3. drivers
console.log("\\na driver reaches only the car they are renting");
seed();
const own = await call(I.listConditionMedia, { vehicleId: V1 }, U1);
ok(own.length === 1 && own[0].vehicle_id === V1, "their own car's photos are theirs to see");
const crossRead = await call(I.listConditionMedia, { vehicleId: V2 }, U1);
ok(crossRead.length === 1 && crossRead[0].vehicle_id === V1,
  "asking for ANOTHER driver's car returns their own, not that one — the id is ignored, not trusted");
ok(!crossRead.some((m) => m.vehicle_id === V2), "  no cross-rental photo is served");

seed();
const upOwn = await call(I.createConditionUploadUrl, { vehicleId: V2, fileName: "x.jpg", mimeType: "image/jpeg" }, U1);
ok(upOwn.path.startsWith(`${V1}/`),
  "a driver's upload is pinned to their OWN car even when they name another");

seed();
msg = await refused(I.confirmConditionUpload, {
  vehicleId: V2, rentalId: R2, inspectionId: null, phase: "checkout", angle: "front",
  path: `${V2}/forged.jpg`, fileName: "f.jpg", mimeType: "image/jpeg", sizeBytes: 10,
}, U1);
ok(msg === "Forbidden", `a driver cannot file a photo against another driver's car (${msg})`);

seed();
const otherInsp = await call(I.startInspection, { vehicleId: V2, templateId: TPL_IN }, "mgr-1");
msg = await refused(I.getInspection, { id: otherInsp.id }, U1);
ok(msg === "Forbidden", `a driver cannot read an inspection on another driver's car (${msg})`);

console.log("\\nand a driver has no staff powers at all");
seed();
for (const [fn, name, data] of [
  [I.startInspection, "startInspection", { vehicleId: V1, templateId: TPL_IN }],
  [I.setInspectionItem, "setInspectionItem", { itemId: "77777777-0000-4000-8000-000000000001", result: "pass" }],
  [I.updateInspection, "updateInspection", { id: R1, odometer: 1 }],
  [I.completeInspection, "completeInspection", { id: R1 }],
  [I.deleteConditionMedia, "deleteConditionMedia", { id: CM1 }],
]) {
  ok((await refused(fn, data, U1)) === "Forbidden", `${name} refuses a driver`);
}
ok(S.tables.inspections.length === 0, "and no inspection was created by any of it");
ok(S.tables.condition_media.length === 2, "and no photo was removed");

// =============================================== 4. anonymous / unknown
console.log("\\nsomebody with no role gets nothing");
seed();
for (const [fn, name, data] of [
  [I.startInspection, "startInspection", { vehicleId: V1, templateId: TPL_IN }],
  [I.deleteConditionMedia, "deleteConditionMedia", { id: CM1 }],
  [I.completeInspection, "completeInspection", { id: R1 }],
]) {
  ok((await refused(fn, data, "nobody")) === "Forbidden", `${name} refuses an unknown caller`);
}
msg = await refused(I.createConditionUploadUrl, { vehicleId: V1, fileName: "x.jpg", mimeType: "image/jpeg" }, "nobody");
ok(msg === "No active rental on file",
  "an unknown caller gets no upload URL — they fall to the driver path and have no rental");
const anonList = await call(I.listConditionMedia, { vehicleId: V1 }, "nobody");
ok(anonList.length === 0, "and no photos");

// =============================================== 5. forged ids
console.log("\\na forged id yields nothing, and leaks nothing");
seed();
msg = await refused(I.startInspection, { vehicleId: FORGED_V, templateId: TPL_IN }, "crd-1");
ok(msg === "That vehicle no longer exists.", `a forged vehicle id is refused by name (${msg})`);
ok(S.tables.inspections.length === 0, "  and nothing was created");
msg = await refused(I.startInspection, { vehicleId: V1, templateId: FORGED_V }, "crd-1");
ok(msg === "Template not found", "a forged template id is refused");
const forgedVehicle = await call(I.listConditionMedia, { vehicleId: FORGED_V }, "crd-1");
ok(forgedVehicle.length === 0, "a forged vehicle id returns no photos");
const forgedRental = await call(I.listConditionMedia, { vehicleId: V1, rentalId: FORGED_R }, "crd-1");
ok(forgedRental.length === 0, "a forged rental id returns no photos, rather than falling back to all of them");
msg = await refused(I.confirmConditionUpload, {
  vehicleId: V1, rentalId: R1, inspectionId: null, phase: "checkin", angle: "front",
  path: `${V2}/sneaky.jpg`, fileName: "s.jpg", mimeType: "image/jpeg", sizeBytes: 10,
}, "crd-1");
ok(msg === "Invalid upload path",
  "and a Coordinator cannot file a photo under a different car by tampering the path");
msg = await refused(I.getInspection, { id: FORGED_R }, "crd-1");
ok(msg === "Inspection not found", "a forged inspection id is refused");

// =============================================== 6. the existing flows still work
console.log("\\nthe renter's own sign-off is untouched");
seed();
const pre = await call(I.startInspection, { vehicleId: V1, templateId: TPL_OUT }, "mgr-1");
ok(!!pre.id, "a pre-delivery inspection still starts");
const toSign = await call(I.getMyCheckoutInspection, {}, U1);
ok(toSign === null || toSign.id !== undefined, "the driver's sign-off read still answers");
ok(/getMyCheckoutInspection/.test(SRC) && /signCheckoutInspection/.test(SRC),
  "and both renter endpoints are still present");
ok(!/canInspect|isStaff/.test(
  code.slice(code.indexOf("export const getMyCheckoutInspection"), code.indexOf("export const signCheckoutInspection")),
), "the renter's read is gated by their own rental, not by a staff predicate");

console.log("\\nand nothing in this module writes outside inspections and condition media");
seed();
await call(I.startInspection, { vehicleId: V1, templateId: TPL_IN }, "crd-1");
const touched = [...new Set(S.log.map((w) => w.table))].sort();
ok(touched.every((t) => ["inspections", "inspection_items", "condition_media", "vehicles"].includes(t)),
  `tables written: ${touched.join(", ") || "none"}`);
ok(!touched.includes("vehicles"), "and starting an inspection touches no vehicle row");
ok(S.rpcs.length === 0, "no database function was called");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\\n${fail} blocker(s)` : "\\nall inspection permission checks pass");
process.exit(fail ? 1 : 0);
