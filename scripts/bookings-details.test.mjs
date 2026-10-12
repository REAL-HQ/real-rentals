/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   OPENING A BOOKING READS. IT NEVER WRITES, AND NEVER TOUCHES THE LIFECYCLE.
 *   THE DRIVER ON THE DETAIL IS THE APPLICATION, NEVER rentals.driver_id.
 *   A COORDINATOR'S DETAIL CONTAINS NO MONEY — NO PAYMENTS, NO DEPOSIT, NOTHING.
 *   WHAT IS MISSING IS NAMED AS MISSING. A BLANK IS NOT A ZERO.
 *   A DRIVER SEES THEIR OWN RENTALS AND NOBODY ELSE'S.
 *
 * Two readers are covered here:
 *
 *   getBooking         — the staff drawer: one rental with its inspections,
 *                        agreements, condition photos, mileage and (Manager+)
 *                        its payments, tolls and deposit.
 *   getMyRentalHistory — the driver's own list, including rentals that ended,
 *                        which the dashboard's "newest ACTIVE rental" read
 *                        could never show them.
 *
 * The fixture keeps rentals.driver_id (an AUTH USER id) different from
 * applications.id (what payments.driver_id and documents.driver_id hold), so a
 * join that confuses the two cannot pass. One rental is deliberately bare —
 * no application, no vehicle, no inspection, no agreement, no readings — to
 * prove the screen reports the gaps instead of inventing values.
 *
 * Real modules, fake Supabase, synthetic rentals. No network, no real record.
 *
 * Run: node scripts/bookings-details.test.mjs   (npm run test:bookings:details)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".bookings-detail-build";
const R1 = "11111111-0000-4000-8000-000000000001"; // active, open-ended, fully papered
const R2 = "11111111-0000-4000-8000-000000000002"; // completed, returned
const R3 = "11111111-0000-4000-8000-000000000003"; // cancelled before it started
const R4 = "11111111-0000-4000-8000-000000000004"; // active, bare record
const A1 = "22222222-0000-4000-8000-000000000001";
const A2 = "22222222-0000-4000-8000-000000000002";
const V1 = "33333333-0000-4000-8000-000000000001";
const V2 = "33333333-0000-4000-8000-000000000002";
/** The auth users behind A1/A2 — deliberately NOT equal to A1/A2. */
const U1 = "44444444-0000-4000-8000-000000000001";
const U2 = "44444444-0000-4000-8000-000000000002";
const MISSING = "99999999-0000-4000-8000-000000000009";

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
build("src/lib/portal.functions.ts", "portal.mjs");

const { getBooking } = await import(`../${OUT}/bookings.mjs`);
const { getMyRentalHistory } = await import(`../${OUT}/portal.mjs`);
const SB = await import(`../${OUT}/stub/supabase.js`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const ROLES = [
  { user_id: "own-1", role: "admin" },
  { user_id: "mgr-1", role: "team" },
  { user_id: "crd-1", role: "coordinator" },
  { user_id: U1, role: "driver" },
  { user_id: U2, role: "driver" },
];
const call = (fn, data, userId = "mgr-1") =>
  fn({ data: fn._validate ? fn._validate(data) : data, context: { userId, supabase: SB.supabaseAdmin } });
const detail = (rentalId, userId = "mgr-1") => call(getBooking, { rentalId }, userId);
const history = (userId, data = {}) => call(getMyRentalHistory, data, userId);

function seed() {
  S.tables = {
    user_roles: ROLES,
    applications: [
      { id: A1, user_id: U1, full_name: "Dana Rivers", email: "dana@example.com", phone: "8135550111", status: "approved" },
      { id: A2, user_id: U2, full_name: "Omar Vance", email: "omar@example.com", phone: "8135550222", status: "approved" },
    ],
    vehicles: [
      { id: V1, unit_number: "RR-001", year: 2013, make: "Ford", model: "Fusion", trim: "SE", license_plate: "ABC1234",
        vin: "1HGCM82633A004352", color: "Blue", status: "rented", photos: ["veh/v1.jpg"],
        gps_device_id: "GPS-1", internal_notes: "spare key in office", purchase_price: 6200 },
      { id: V2, unit_number: "RR-002", year: 2016, make: "Toyota", model: "Camry", trim: "LE", license_plate: "XYZ7788",
        vin: "1HGCM82633A004353", color: "Grey", status: "available", photos: ["veh/v2.jpg"],
        gps_device_id: "GPS-2", internal_notes: "needs tires", purchase_price: 8100 },
    ],
    rentals: [
      { id: R1, status: "active", start_date: "2026-09-01", end_date: null, created_at: "2026-09-01T10:00:00Z",
        vehicle_id: V1, driver_id: U1, application_id: A1, weekly_rate: 350, deposit_amount: 300, deposit_held: true,
        deposit_status: "held", deposit_refund_amount: null, payment_status: "current", next_payment_due: "2026-10-12",
        autopay_active: true, pickup_reading_id: "re-1", return_reading_id: null },
      { id: R2, status: "ended", start_date: "2026-05-01", end_date: "2026-08-01", created_at: "2026-05-01T10:00:00Z",
        vehicle_id: V2, driver_id: U2, application_id: A2, weekly_rate: 400, deposit_amount: 300, deposit_held: false,
        deposit_status: "refunded", deposit_refund_amount: 250, payment_status: "current", next_payment_due: null,
        autopay_active: false, pickup_reading_id: "re-2", return_reading_id: "re-3" },
      { id: R3, status: "cancelled", start_date: "2026-04-01", end_date: "2026-04-02", created_at: "2026-04-01T10:00:00Z",
        vehicle_id: V2, driver_id: U2, application_id: A2, weekly_rate: 400, deposit_amount: 300, deposit_held: false,
        deposit_status: "none", deposit_refund_amount: null, payment_status: "current", next_payment_due: null,
        autopay_active: false, pickup_reading_id: null, return_reading_id: null },
      // The bare record: nothing attached to it at all.
      { id: R4, status: "active", start_date: null, end_date: null, created_at: "2026-10-01T10:00:00Z",
        vehicle_id: null, driver_id: U1, application_id: null, weekly_rate: 300, payment_status: "late",
        pickup_reading_id: null, return_reading_id: null },
    ],
    inspections: [
      { id: "i-1", rental_id: R1, vehicle_id: V1, inspection_type: "pre_delivery", status: "passed",
        created_at: "2026-09-01T09:00:00Z", started_at: "2026-09-01T08:30:00Z", completed_at: "2026-09-01T09:00:00Z",
        odometer: 41000, inspector_name: "Luis", driver_signed_at: "2026-09-01T09:05:00Z" },
      { id: "i-2", rental_id: R2, vehicle_id: V2, inspection_type: "return", status: "passed",
        created_at: "2026-08-01T09:00:00Z", started_at: "2026-08-01T08:30:00Z", completed_at: "2026-08-01T09:00:00Z",
        odometer: 29000, inspector_name: "Luis", driver_signed_at: null },
    ],
    agreements: [
      { id: "ag-1", rental_id: R1, title: "Rental Agreement", status: "signed", created_at: "2026-09-01T07:00:00Z",
        sent_at: "2026-09-01T06:00:00Z", signed_at: "2026-09-01T07:00:00Z", voided_at: null,
        archive_status: "archived", document_id: "doc-1" },
      { id: "ag-0", rental_id: R1, title: "Rental Agreement", status: "voided", created_at: "2026-08-30T07:00:00Z",
        sent_at: "2026-08-30T06:00:00Z", signed_at: null, voided_at: "2026-08-31T07:00:00Z",
        archive_status: "archived", document_id: null },
      { id: "ag-2", rental_id: R2, title: "Rental Agreement", status: "signed", created_at: "2026-05-01T07:00:00Z",
        sent_at: "2026-05-01T06:00:00Z", signed_at: "2026-05-01T07:00:00Z", voided_at: null,
        archive_status: "archived", document_id: "doc-2" },
    ],
    condition_media: [
      { id: "cm-1", rental_id: R1, inspection_id: "i-1", path: "cond/1.jpg" },
      { id: "cm-2", rental_id: R1, inspection_id: "i-1", path: "cond/2.jpg" },
      { id: "cm-3", rental_id: R2, inspection_id: "i-2", path: "cond/3.jpg" },
    ],
    // payments.driver_id is an APPLICATIONS id — the other meaning of the name.
    payments: [
      { id: "p-1", rental_id: R1, driver_id: A1, vehicle_id: V1, type: "rent", status: "due", amount: 350,
        balance_due: 350, due_date: "2026-10-05", paid_date: null, net_collected: null },
      { id: "p-2", rental_id: R1, driver_id: A1, vehicle_id: V1, type: "rent", status: "paid", amount: 350,
        balance_due: 0, due_date: "2026-09-28", paid_date: "2026-09-28", net_collected: 338.5 },
      { id: "p-3", rental_id: R2, driver_id: A2, vehicle_id: V2, type: "rent", status: "paid", amount: 400,
        balance_due: 0, due_date: "2026-07-28", paid_date: "2026-07-28", net_collected: 387.2 },
    ],
    toll_charges: [
      { id: "t-1", rental_id: R1, charge_type: "toll", agency: "SunPass", amount: 4.25, admin_fee: 5,
        status: "rebilled", occurred_at: "2026-09-20T14:00:00Z" },
    ],
    incidents: [{ id: "inc-1", rental_id: R1, summary: "kerbed wheel" }],
    odometer_readings: [
      { id: "re-1", rental_id: R1, vehicle_id: V1, mileage: 41000 },
      { id: "re-2", rental_id: R2, vehicle_id: V2, mileage: 22000 },
      { id: "re-3", rental_id: R2, vehicle_id: V2, mileage: 29000 },
    ],
    audit_log: [],
  };
  S.log = []; S.audit = []; S.defaults = {};
}

// ======================================================= the rental itself
console.log("\\nopening a rental returns that rental, read from the record");
seed();
let d1 = await detail(R1);
ok(!!d1, "the active rental opens");
ok(d1.booking.id === R1 && d1.booking.source === "rental", "it is the rental, not a second record");
ok(d1.booking.phase === "active" && d1.booking.status === "active", "its phase is read from its status");
ok(d1.booking.openEnded === true && d1.booking.endDate === null,
  "an active rental with no end date is open-ended, not missing a date");
const d2 = await detail(R2);
ok(d2.booking.phase === "completed" && d2.booking.openEnded === false,
  "a returned rental is completed and not open-ended");
ok((await detail(MISSING)) === null, "a rental that does not exist returns null, not an empty booking");

// ======================================================= the driver join
console.log("\\nthe driver is resolved through application_id");
ok(d1.driver.name === "Dana Rivers" && d1.driver.email === "dana@example.com",
  `the name comes from the applications row (${d1.driver.name})`);
ok(d1.driver.phone === "8135550111" && d1.driver.applicationStatus === "approved",
  "with their contact detail and application status");
ok(d1.driver.applicationId === A1, "applicationId is the person's record");
ok(d1.driver.portalUserId === U1, "the portal login is reported separately, under its own name");
ok(d1.driver.applicationId !== d1.driver.portalUserId,
  "  and in this fixture the two values differ, so a confused join cannot pass");
ok(!("driver_id" in d1.driver), "the detail never ships a bare driver_id to be guessed at");
ok(d2.driver.name === "Omar Vance" && d2.driver.applicationId === A2,
  "the other rental resolves to the other applicant, not the first");

console.log("\\na rental with no application names no driver");
const d4 = await detail(R4);
ok(d4.driver.name === null && d4.driver.email === null && d4.driver.applicationId === null,
  "no application means no name — nothing is invented");
ok(d4.driver.portalUserId === U1, "  though the login on the rental row is still reported");

// ======================================================= the vehicle join
console.log("\\nthe vehicle is the one on the rental");
ok(d1.vehicle?.id === V1 && d1.vehicle.unitNumber === "RR-001", "the right car, by unit number");
ok(d1.vehicle.label === "2013 Ford Fusion" && d1.vehicle.plate === "ABC1234", "named from its own columns");
ok(d2.vehicle?.id === V2 && d2.vehicle.unitNumber === "RR-002", "and the other rental has the other car");
ok(d4.vehicle === null, "a rental with no vehicle says so rather than guessing one");
for (const forbidden of ["gps_device_id", "internal_notes", "purchase_price", "gpsDeviceId", "internalNotes", "purchasePrice"]) {
  ok(!(forbidden in (d1.vehicle ?? {})), `the vehicle block carries no ${forbidden}`);
}

// ======================================================= mileage
console.log("\\nmileage comes from the readings the rental points at");
ok(d1.mileage.pickup === 41000, "pickup mileage is the pickup reading");
ok(d1.mileage.return === null, "an active rental has no return reading, and reports null not 0");
ok(d2.mileage.pickup === 22000 && d2.mileage.return === 29000, "a returned rental has both");
ok(d4.mileage.pickup === null && d4.mileage.return === null, "a rental with no readings reports neither");

// ======================================================= paperwork
console.log("\\nthe paperwork already on the rental is listed, newest first");
ok(d1.inspections.length === 1 && d1.inspections[0].id === "i-1", "its inspection is found by rental_id");
ok(d1.inspections[0].type === "pre_delivery" && d1.inspections[0].odometer === 41000,
  "with its type and odometer as recorded");
ok(d1.inspections[0].photoCount === 2, `condition photos are counted per inspection (${d1.inspections[0].photoCount})`);
ok(d1.agreements.length === 2, "both agreements on the rental are listed");
ok(d1.agreements[0].id === "ag-1" && d1.agreements[0].status === "signed",
  "the newest first, so the live one leads");
ok(d1.agreements[1].status === "voided" && d1.agreements[1].voidedAt !== null,
  "a voided agreement is still shown as voided, not hidden");
ok(d1.agreements[0].documentId === "doc-1" && d1.agreements[0].archiveStatus === "archived",
  "the archive status travels with it");
ok(d2.inspections.length === 1 && d2.inspections[0].type === "return", "the returned rental has its return inspection");
ok(d4.inspections.length === 0 && d4.agreements.length === 0, "the bare rental has neither, and claims neither");

console.log("\\nthe counts describe this rental");
ok(d1.counts.inspections === 1 && d1.counts.agreements === 2, "inspections and agreements are counted");
ok(d1.counts.conditionPhotos === 2, "condition photos are counted");
ok(d1.counts.incidents === 1, "incidents are counted without reading their detail");
ok(d2.counts.conditionPhotos === 1, "and the other rental's photos are not added to the first's");
ok(d4.counts.inspections === 0 && d4.counts.agreements === 0 && d4.counts.conditionPhotos === 0 &&
  d4.counts.incidents === 0, "the bare rental counts zero of everything");

// ======================================================= honest gaps
console.log("\\nwhat is missing is named as missing");
ok(d1.unavailable.includes("Return mileage pending return"),
  "an active rental's missing return mileage is pending, not an error");
ok(!d1.unavailable.includes("Driver record not linked") && !d1.unavailable.includes("No agreement on file"),
  "a complete rental does not report gaps it does not have");
ok(d2.unavailable.length === 0, `a finished, fully papered rental reports nothing missing (${d2.unavailable.join("; ")})`);
for (const expected of ["Driver record not linked", "Start date not recorded", "Pickup mileage not recorded",
  "No inspection on file", "No agreement on file"]) {
  ok(d4.unavailable.includes(expected), `the bare rental reports: ${expected}`);
}
ok(!d4.unavailable.includes("End date not recorded"),
  "but an active rental's absent end date is not called a gap — it is open-ended");

// ======================================================= the money boundary
console.log("\\na Coordinator's detail contains no money at all");
seed();
const crd = await detail(R1, "crd-1");
ok(crd.canSeeMoney === false, "the answer says so");
ok(crd.money === undefined, "the money block is ABSENT, not empty");
ok(crd.inspections.length === 1 && crd.agreements.length === 2 && crd.vehicle?.unitNumber === "RR-001",
  "  and the operational record is still theirs to see in full");
for (const forbidden of ["weeklyRate", "paymentStatus", "depositStatus", "balanceDue"]) {
  ok(!(forbidden in crd.booking), `${forbidden} is ABSENT from the booking, not null or hidden`);
}
const crdText = JSON.stringify(crd);
ok(!crdText.includes("350") && !crdText.includes("338.5"), "no rate or collected amount leaks anywhere in the payload");
ok(!crdText.includes("deposit"), "and no deposit field reaches them under any name");
ok(crd.counts.payments === 0 && crd.counts.charges === 0,
  "even the payment and charge COUNTS are withheld — a count is a financial fact");

console.log("\\ncontrol: a Manager does get the money, so the absence above is the boundary");
const mgr = d1;
ok(mgr.canSeeMoney === true && !!mgr.money, "the money block is present for a Manager");
ok(mgr.booking.weeklyRate === 350 && mgr.booking.paymentStatus === "current", "with the real rate and status");
ok(mgr.booking.balanceDue === 350, `and the unpaid rent only (${mgr.booking.balanceDue})`);
ok(mgr.money.payments.length === 2 && mgr.money.payments.every((p) => p.id !== "p-3"),
  "the payments are this rental's, by rental_id — not the other rental's");
ok(mgr.money.payments.some((p) => p.netCollected === 338.5), "net_collected is what revenue means here");
ok(mgr.money.charges.length === 1 && mgr.money.charges[0].agency === "SunPass", "tolls are listed as charges");
ok(mgr.money.deposit.amount === 300 && mgr.money.deposit.held === true && mgr.money.deposit.status === "held",
  "the deposit is reported as the record holds it");
ok(d2.money.deposit.refunded === 250, "a refunded deposit reports what was refunded");
ok(d2.booking.balanceDue === 0, "a settled rental owes nothing");
const own = await detail(R1, "own-1");
ok(own.canSeeMoney === true && own.money.payments.length === 2, "an Owner sees money too");

console.log("\\nand nobody outside staff opens a booking at all");
seed();
let threw = null;
try { await detail(R1, "nobody"); } catch (e) { threw = e; }
ok(!!threw && /Forbidden/.test(String(threw.message)), "getBooking refuses a non-staff caller");
threw = null;
try { await detail(R1, U1); } catch (e) { threw = e; }
ok(!!threw && /Forbidden/.test(String(threw.message)), "  including a driver, who has their own read");

// ======================================================= nothing is written
console.log("\\nopening a booking writes nothing");
seed();
await detail(R1);
await detail(R1, "crd-1");
await detail(R4);
await detail(MISSING);
ok(S.log.length === 0, `no insert, update or delete was issued (${S.log.length} writes)`);
ok((S.audit ?? []).length === 0, "and nothing was audited — opening a drawer is not an event");

// ======================================================= the driver's own history
console.log("\\na driver sees their own rentals, the ended ones included");
seed();
const mine = await history(U1);
ok(mine.length === 2, `both of this driver's rentals are returned (${mine.length})`);
ok(mine.every((x) => x.id === R1 || x.id === R4), "and only theirs");
ok(mine.some((x) => x.id === R1), "their active rental is there");
const hist2 = await history(U2);
ok(hist2.length === 2 && hist2.every((x) => x.id === R2 || x.id === R3),
  `the other driver gets their own two records (${hist2.map((x) => x.id).join(", ")})`);
ok(hist2.some((x) => x.phase === "Completed"),
  "a rental that ENDED is visible to the driver who had it — the whole point of the history");
ok(hist2.some((x) => x.phase === "Cancelled"),
  "and a cancelled one is shown as cancelled, not quietly dropped");
ok(!hist2.some((x) => x.id === R1) && !hist2.some((x) => x.id === R4),
  "and never the first driver's rentals");

console.log("\\nthe history is read the way the record reads");
const h1 = mine.find((x) => x.id === R1);
ok(h1.phase === "Active" && h1.open_ended === true, "an open-ended rental says Active and open-ended");
ok(h1.vehicle?.make === "Ford" && h1.vehicle.plate === "ABC1234", "the car they drove is named");
ok(h1.vehicle.photo === "veh/v1.jpg", "with its first photo");
ok(h1.agreement?.id === "ag-1" && h1.agreement.status === "signed",
  "their own agreement for that rental is linked, the newest one");
const h4 = mine.find((x) => x.id === R4);
ok(h4.vehicle === null && h4.agreement === null, "a rental with no car and no agreement claims neither");
ok(h4.open_ended === true, "and is still open-ended");
const hEnded = hist2.find((x) => x.id === R2);
ok(hEnded.end_date === "2026-08-01" && hEnded.open_ended === false, "an ended rental reports its end date");
ok(hEnded.weekly_rate === 400, "a driver may see their OWN rate — it is their contract");

console.log("\\nthe history ships none of the car's internal columns");
const mineText = JSON.stringify(mine);
for (const forbidden of ["gps_device_id", "internal_notes", "purchase_price", "vin", "unit_number"]) {
  ok(!mineText.includes(forbidden), `no ${forbidden} reaches the driver`);
}
ok(!mineText.includes("GPS-1") && !mineText.includes("spare key"), "nor their values under another name");

console.log("\\na driver with no rental gets an empty list, not an error");
seed();
S.tables.rentals = [];
ok((await history(U1)).length === 0, "an empty history is empty");

console.log("\\nreading the history writes nothing");
seed();
await history(U1);
await history(U2);
ok(S.log.length === 0, `no write was issued (${S.log.length})`);

// ======================================================= Driver Preview
console.log("\\nDriver Preview reads through the same checked path");
seed();
threw = null;
try { await history("crd-1", { previewDriverId: U1 }); } catch (e) { threw = e; }
ok(!!threw, "a Coordinator cannot preview a driver's history (Manager+ only)");
const previewed = await history("mgr-1", { previewDriverId: U1 });
ok(previewed.length === 2 && previewed.every((x) => x.id === R1 || x.id === R4),
  "a Manager previewing a real driver sees that driver's history");
ok(S.log.length === 0, "  and the preview writes nothing");
threw = null;
try { await history("mgr-1", { previewDriverId: MISSING }); } catch (e) { threw = e; }
ok(!!threw && /Driver not found/.test(String(threw.message)),
  "a previewDriverId that is not a driver account is refused, not trusted");
threw = null;
try { await history("mgr-1", { previewDriverId: "not-a-uuid" }); } catch (e) { threw = e; }
ok(!!threw && /Invalid driver/.test(String(threw.message)), "and a malformed one never reaches the database");
ok(!(await history("mgr-1")).length, "a Manager with no preview id reads their OWN rentals, not every driver's");

// ======================================================= the source itself
console.log("\\nthe readers are readers");
const DETAIL_SRC = readFileSync("src/lib/bookings.functions.ts", "utf8");
const PORTAL_SRC = readFileSync("src/lib/portal.functions.ts", "utf8");
// The header comments name the rental transactions on purpose, to say why
// nothing here calls them. So judge the code, not the prose.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const DETAIL_CODE = strip(DETAIL_SRC);
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "activate_rental_tx", "end_rental_tx"]) {
  ok(!DETAIL_CODE.includes(forbidden), `bookings.functions.ts has no ${forbidden.replace(/[().]/g, "")} outside comments`);
}
const HISTORY_FN = PORTAL_SRC.slice(
  PORTAL_SRC.indexOf("export const getMyRentalHistory"),
  PORTAL_SRC.indexOf("export type DriverDocument"),
);
const HISTORY_CODE = strip(HISTORY_FN);
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "activate_rental_tx", "end_rental_tx"]) {
  ok(!HISTORY_CODE.includes(forbidden), `getMyRentalHistory has no ${forbidden.replace(/[().]/g, "")}`);
}
ok(/\.eq\("driver_id", userId\)/.test(HISTORY_CODE),
  "the history is scoped to the caller's own id in the query, not filtered afterwards");
ok(/scope\(context, input, "rental_history"\)/.test(HISTORY_CODE),
  "and that id comes from the checked portal scope, never from the request body");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\\n${fail} blocker(s)` : "\\nall Bookings detail checks pass");
process.exit(fail ? 1 : 0);
