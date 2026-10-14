/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A BOOKING IS A RENTAL. NO SECOND RECORD, AND NOTHING WRITTEN TO SEE ONE.
 *   A COORDINATOR'S ANSWER CONTAINS NO MONEY — NOT HIDDEN MONEY, NO MONEY.
 *   rentals.driver_id IS A LOGIN. payments.driver_id IS A PERSON'S RECORD.
 *   THE COUNTS COUNT THE SCOPE, NEVER THE PAGE.
 *   AN UPCOMING BOOKING IS NEVER INVENTED FROM A RENTAL THAT DOES NOT EXIST.
 *
 * Phase A of Bookings reads the rentals that already exist. Everything the
 * screen needs already pointed at the rental — inspections, agreements,
 * payments, condition media, odometer readings, toll charges, incidents all
 * carry rental_id — so the risk here is not a missing join, it is a wrong one:
 *
 *   rentals.driver_id holds an AUTH USER id (activate_rental_tx sets it from
 *   applications.user_id). payments.driver_id and documents.driver_id hold an
 *   APPLICATIONS row id. Same column name, different meaning, and the fixture
 *   below deliberately makes them disagree so a careless join cannot pass.
 *
 *   A Coordinator is staff and may see the operational record, but rent,
 *   deposits and balances are Manager-and-above. UI hiding is not a boundary,
 *   so the assertions check the SHAPE of what the server sent.
 *
 * Real modules, fake Supabase, synthetic rentals. No network, no paid call,
 * no real record.
 *
 * Run: node scripts/bookings-list.test.mjs   (npm run test:bookings)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".bookings-build";
const R1 = "11111111-0000-4000-8000-000000000001"; // active, open-ended
const R2 = "11111111-0000-4000-8000-000000000002"; // completed
const R3 = "11111111-0000-4000-8000-000000000003"; // cancelled
const R4 = "11111111-0000-4000-8000-000000000004"; // active, no application linked
const A1 = "22222222-0000-4000-8000-000000000001";
const A2 = "22222222-0000-4000-8000-000000000002";
const V1 = "33333333-0000-4000-8000-000000000001";
const V2 = "33333333-0000-4000-8000-000000000002";
/** The auth user behind A1 — deliberately NOT equal to A1. */
const U1 = "44444444-0000-4000-8000-000000000001";
const U2 = "44444444-0000-4000-8000-000000000002";

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
];
const build = (entry, out) =>
  execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/${out}`, ...alias],
    { stdio: ["ignore", "ignore", "inherit"] });

build("src/lib/bookings.functions.ts", "bookings.mjs");
build("src/lib/bookings-list.ts", "rules.mjs");

const { listBookings } = await import(`../${OUT}/bookings.mjs`);
const L = await import(`../${OUT}/rules.mjs`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const ROLES = [
  { user_id: "own-1", role: "admin" },
  { user_id: "mgr-1", role: "team" },
  { user_id: "crd-1", role: "coordinator" },
];
const call = (fn, data, userId = "mgr-1") =>
  fn({ data: fn._validate ? fn._validate(data) : data, context: { userId } });
const list = (over = {}, userId = "mgr-1") =>
  call(listBookings, { q: "", phase: "all", sort: "recent", page: 1, pageSize: 25, ...over }, userId);

function seed() {
  S.tables = {
    user_roles: ROLES,
    applications: [
      { id: A1, user_id: U1, full_name: "Dana Rivers", email: "dana@example.com", phone: "8135550111", status: "approved" },
      { id: A2, user_id: U2, full_name: "Omar Vance", email: "omar@example.com", phone: "8135550222", status: "approved" },
    ],
    vehicles: [
      { id: V1, unit_number: "RR-001", year: 2013, make: "Ford", model: "Fusion", license_plate: "ABC1234", vin: "1HGCM82633A004352", color: "Blue", status: "rented" },
      { id: V2, unit_number: "RR-002", year: 2016, make: "Toyota", model: "Camry", license_plate: "XYZ7788", vin: "1HGCM82633A004353", color: "Grey", status: "available" },
    ],
    rentals: [
      { id: R1, status: "active", start_date: "2026-09-01", end_date: null, created_at: "2026-09-01T10:00:00Z",
        vehicle_id: V1, driver_id: U1, application_id: A1, weekly_rate: 350, deposit_amount: 300, deposit_held: true,
        deposit_status: "held", payment_status: "current", pickup_reading_id: "re-1", return_reading_id: null },
      { id: R2, status: "ended", start_date: "2026-05-01", end_date: "2026-08-01", created_at: "2026-05-01T10:00:00Z",
        vehicle_id: V2, driver_id: U2, application_id: A2, weekly_rate: 400, deposit_amount: 300, deposit_held: false,
        deposit_status: "refunded", payment_status: "current", pickup_reading_id: "re-2", return_reading_id: "re-3" },
      { id: R3, status: "cancelled", start_date: "2026-04-01", end_date: "2026-04-02", created_at: "2026-04-01T10:00:00Z",
        vehicle_id: V2, driver_id: U2, application_id: A2, weekly_rate: 400, payment_status: "current" },
      { id: R4, status: "active", start_date: "2026-10-01", end_date: null, created_at: "2026-10-01T10:00:00Z",
        vehicle_id: null, driver_id: U1, application_id: null, weekly_rate: 300, payment_status: "late" },
    ],
    // payments.driver_id is an APPLICATIONS id — the other meaning of the name.
    payments: [
      { id: "p-1", rental_id: R1, driver_id: A1, vehicle_id: V1, type: "rent", status: "due", amount: 350, balance_due: 350, due_date: "2026-10-05" },
      { id: "p-2", rental_id: R1, driver_id: A1, vehicle_id: V1, type: "rent", status: "paid", amount: 350, balance_due: 0, paid_date: "2026-09-28" },
      { id: "p-3", rental_id: R2, driver_id: A2, vehicle_id: V2, type: "rent", status: "paid", amount: 400, balance_due: 0, paid_date: "2026-07-28" },
    ],
    odometer_readings: [
      { id: "re-1", rental_id: R1, vehicle_id: V1, mileage: 41000 },
      { id: "re-2", rental_id: R2, vehicle_id: V2, mileage: 22000 },
      { id: "re-3", rental_id: R2, vehicle_id: V2, mileage: 29000 },
    ],
    inspections: [], agreements: [], condition_media: [], toll_charges: [], incidents: [], audit_log: [],
  };
  S.log = []; S.audit = []; S.defaults = {};
}
const byId = (rows, id) => rows.find((r) => r.id === id);

// ======================================================= the phase reading
console.log("\\nthe phase is a reading of the status, not a new column");
ok(L.bookingPhase("active") === "active", "active is Active");
ok(L.bookingPhase("ended") === "completed", "ended is Completed");
ok(L.bookingPhase("cancelled") === "cancelled" && L.bookingPhase("canceled") === "cancelled",
  "both spellings of cancelled are read");
ok(L.bookingPhase(null) === "completed", "an unknown status is not reported as active");
ok(L.bookingPhase("reserved") === "reserved", "the reserved phase exists for the reservation engine");
ok(L.bookingDates("2026-09-01", null, "active") === "2026-09-01 → Open-ended",
  "an open-ended rental says so instead of printing a dash");
ok(/not recorded/i.test(L.bookingDates("2026-05-01", null, "completed")),
  "a finished rental with no end date says the date is missing, not open-ended");
ok(/not recorded/i.test(L.bookingDates(null, null, "active")), "no start date is named as missing");

// ======================================================= the list
console.log("\\nthe list shows every rental, not only the live one");
seed();
let r = await list();
ok(r.rows.length === 4, `all four rentals are listed (${r.rows.length})`);
ok(r.total === 4, "the total agrees");
ok(r.rows.every((x) => x.source === "rental"), "every row says it came from a rental");
ok(!r.rows.some((x) => x.phase === "reserved"), "and none claims to be an upcoming booking");

console.log("\\nthe driver comes from the application, never from driver_id");
const a = byId(r.rows, R1);
ok(a.driverName === "Dana Rivers", `the name is resolved through application_id (${a.driverName})`);
ok(a.applicationId === A1, "applicationId is the person's record");
ok(a.driverUserId === U1, "driverUserId is the portal login, kept separate");
ok(a.applicationId !== a.driverUserId, "  and the two are not the same value in this fixture");
const d = byId(r.rows, R4);
ok(d.driverName === null && d.applicationId === null,
  "a rental with no application cannot name a driver, and does not invent one");
ok(d.driverUserId === U1, "  though its portal login is still recorded");

console.log("\\nthe vehicle and the dates are what the record says");
ok(a.unitNumber === "RR-001" && a.vehicleLabel === "2013 Ford Fusion" && a.plate === "ABC1234",
  "the vehicle is named from the vehicles row");
ok(a.openEnded === true && a.endDate === null, "an active rental with no end date is open-ended");
ok(byId(r.rows, R2).openEnded === false, "a finished one is not");
ok(byId(r.rows, R4).unitNumber === null, "a rental with no vehicle says so rather than guessing");

// ======================================================= counts and paging
console.log("\\nthe counts count the scope, not the page");
seed();
const p1 = await list({ pageSize: 1, page: 1 });
const p2 = await list({ pageSize: 1, page: 2 });
ok(p1.rows.length === 1 && p2.rows.length === 1, "one row per page");
ok(p1.total === 4 && p2.total === 4, `the total is the scope (${p1.total})`);
ok(p1.rows[0].id !== p2.rows[0].id, "the two pages are different rentals");
ok(JSON.stringify(p1.counts) === JSON.stringify(p2.counts), "the counts do not move as you page");
ok(p1.counts.active === 2 && p1.counts.completed === 1 && p1.counts.cancelled === 1,
  `2 active, 1 completed, 1 cancelled (${JSON.stringify(p1.counts)})`);

console.log("\\nfiltering by phase returns that phase and pages correctly");
for (const [phase, n] of [["active", 2], ["completed", 1], ["cancelled", 1]]) {
  seed();
  const f = await list({ phase });
  ok(f.rows.length === n && f.rows.every((x) => x.phase === phase), `${phase}: ${n} row(s), all of that phase`);
  ok(f.total === n, `  and a total of ${n}, so the pager agrees`);
  ok(f.counts.active === 2, "  while the chips still count the whole scope");
}
seed();
ok((await list({ phase: "../../etc" })).rows.length === 4, "an unknown phase falls back to every rental, not none");

// ======================================================= search
console.log("\\nthe search finds a person or a car");
seed();
ok((await list({ q: "dana" })).rows.length === 1, "by driver name");
ok((await list({ q: "omar@example.com" })).rows.length === 2, "by email — both of that driver's rentals");
ok((await list({ q: "RR-001" })).rows.length === 1, "by unit number");
ok((await list({ q: "xyz7788" })).rows.length === 2, "by plate, case-insensitively");
ok((await list({ q: "1HGCM82633A004352" })).rows.length === 1, "by VIN");
const none = await list({ q: "nobody-by-that-name" });
ok(none.rows.length === 0 && none.total === 0, "a search that matches nobody returns nothing");
ok(none.counts.active === 0, "  and the counts agree rather than reporting the whole fleet");

console.log("\\none vehicle's rentals");
seed();
const v2 = await list({ vehicleId: V2 });
ok(v2.rows.length === 2 && v2.rows.every((x) => x.vehicleId === V2), "filtering by vehicle returns only that car's rentals");
ok(v2.counts.completed === 1 && v2.counts.cancelled === 1 && v2.counts.active === 0,
  "and the counts describe that scope");

// ======================================================= money boundary
console.log("\\na Coordinator's answer contains no money at all");
seed();
const crd = await list({}, "crd-1");
ok(crd.canSeeMoney === false, "the answer says so");
ok(crd.rows.length === 4, "  and still contains every rental — the operational record is theirs to see");
for (const key of ["weeklyRate", "paymentStatus", "depositStatus", "balanceDue"]) {
  ok(crd.rows.every((x) => !(key in x)), `${key} is ABSENT from the row, not null or hidden`);
}
ok(JSON.stringify(crd.rows).indexOf("350") === -1, "no rate leaks anywhere in the payload");
const mgr = await list({}, "mgr-1");
ok(mgr.canSeeMoney === true && mgr.rows.every((x) => "weeklyRate" in x),
  "control: a Manager DOES get the money fields, so the absence above is the boundary");
ok(byId(mgr.rows, R1).weeklyRate === 350, "  with the real rate");
ok(byId(mgr.rows, R1).balanceDue === 350, "  and the outstanding balance of the unpaid rent only");
ok(byId(mgr.rows, R2).balanceDue === 0, "  a settled rental owes nothing");
const own = await list({}, "own-1");
ok(own.canSeeMoney === true, "an Owner sees money too");

console.log("\\nand a Coordinator cannot ask their way past it");
seed();
const crdSearch = await list({ q: "dana", phase: "active" }, "crd-1");
ok(crdSearch.rows.length === 1 && !("weeklyRate" in crdSearch.rows[0]),
  "filters and searches do not change what the server will send them");

console.log("\\nsomeone with no staff role is refused");
seed();
let threw = null;
try { await list({}, "nobody"); } catch (e) { threw = e; }
ok(!!threw && /Forbidden/.test(String(threw.message)), "listBookings refuses a non-staff caller");

// ======================================================= nothing is written
console.log("\\nreading the list writes nothing");
seed();
await list();
await list({}, "crd-1");
await list({ q: "dana" });
ok(S.log.length === 0, `no insert, update or delete was issued (${S.log.length} writes)`);
ok((S.audit ?? []).length === 0, "and nothing was audited — a read is not an event");
const SRC = readFileSync("src/lib/bookings.functions.ts", "utf8");
// The header comment names the rental transactions on purpose, to say why nothing
// here calls them. So judge the code, not the prose: strip comments first.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "activate_rental_tx", "end_rental_tx"]) {
  ok(!CODE.includes(forbidden), `no ${forbidden.replace(/[().]/g, "")} outside comments`);
}
for (const named of ["activate_rental_tx", "end_rental_tx"]) {
  ok(SRC.includes(named), `the header still explains why it never calls ${named}`);
}
ok(/requireStaff/.test(SRC) && /tierAllows\(actor\.tier, "manager"\)/.test(SRC),
  "it gates on staff, and on manager for money");

console.log("\\nthe row carries no column a staff tier may not see");
seed();
const keys = Object.keys(byId((await list({}, "crd-1")).rows, R1));
for (const forbidden of ["vin", "internal_notes", "gps_device_id", "title_number", "purchase_price"]) {
  ok(!keys.includes(forbidden), `the list row has no ${forbidden}`);
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\\n${fail} blocker(s)` : "\\nall Bookings list checks pass");
process.exit(fail ? 1 : 0);
