/**
 * The real generation step (agreements.functions.ts prepareAgreement, via
 * amendmentSendCheck) prints the PROPOSED weekly rate for an updated
 * agreement, names the active rental's car, and changes nothing on file.
 * No database, no network. Run: node scripts/rental-amendment-render.test.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };
const OUT = ".rental-amendment-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stub-start.js`, `
export const createServerFn = () => { const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => fn }; return api; };
export const createServerOnlyFn = (fn) => fn;
`);
writeFileSync(`${OUT}/stub-start-server.js`, `export const getRequest = () => ({ headers: new Map() }); export const getRequestHeader = () => null;`);
writeFileSync(`${OUT}/stub-auth.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub-sb.js`, `
export const supabaseAdmin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
export const supabase = supabaseAdmin; export default supabaseAdmin;
`);
execFileSync("npx", ["esbuild", "src/lib/agreements.functions.ts", "--bundle", "--platform=node",
  "--format=esm", `--outfile=${OUT}/ag.mjs`, "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
  `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`],
  { stdio: ["ignore", "ignore", "inherit"] });
execFileSync("npx", ["esbuild", "src/lib/rental-amendment.ts", "--bundle", "--platform=node",
  "--format=esm", `--outfile=${OUT}/ra.mjs`, "--alias:@=./src"], { stdio: ["ignore", "ignore", "inherit"] });
const AG = await import(`../${OUT}/ag.mjs`);
const RA = await import(`../${OUT}/ra.mjs`);

const writes = [];
function fakeAdmin(tables) {
  return {
    from(name) {
      const filters = []; let cap;
      // Copies, like PostgREST: nothing the code does in memory reaches the "database".
      const rows = () => { const all = (tables[name] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })); return cap == null ? all : all.slice(0, cap); };
      const api = {
        insert: () => { writes.push(["insert", name]); return api; }, update: () => { writes.push(["update", name]); return api; }, upsert: () => { writes.push(["upsert", name]); return api; }, delete: () => { writes.push(["delete", name]); return api; },
        select: () => api, eq: (c, v) => (filters.push((r) => r[c] === v), api), is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), api),
        in: (c, v) => (filters.push((r) => v.includes(r[c])), api), order: () => api, limit: (n) => ((cap = n), api),
        maybeSingle: async () => (name === "license_dmv_checks" && !(name in tables) ? { data: null, error: { code: "42P01", message: "license_dmv_checks does not exist" } } : { data: rows()[0] ?? null, error: null }),
        then: (res, rej) => Promise.resolve(name === "license_dmv_checks" && !(name in tables) ? { data: null, error: { code: "42P01", message: "license_dmv_checks does not exist" } } : { data: rows(), error: null }).then(res, rej),
      };
      return api;
    },
  };
}
/** Writes would show up here; there must be none. */
const APP_ID = "11111111-1111-4111-8111-111111111111";
const VEH_ID = "22222222-2222-4222-8222-222222222222";
const APP = {
  id: APP_ID, full_name: "Dana Reyes", email: "dana@example.com", phone: "813-555-0142", address: "1200 N Ashley Dr", city: "Tampa", state: "FL", zip: "33602",
  license_number: "R123-456-78-901-0", license_state: "FL", license_expiration: "2030-04-30", vehicle_id: VEH_ID, weekly_rent: 350, deposit_amount: 0,
  market_id: null, dob: "1991-07-02", card_brand: "visa", card_last4: "4242", insurance_carrier: "", insurance_policy_number: "",
  contract_start_date: "2026-10-01", contract_end_date: "2027-04-01",
};
const VEHICLE = { id: VEH_ID, year: 2020, make: "Ford", model: "Fusion", trim: "SE", color: "White", vin: "1HGCM82633A004352", unit_number: "40", weekly_rate: 350, deposit: 0, license_plate: "ED40NC", plate_state: "FL" };
// A saved, active plain template (a saved template wins over the v1.14 default).
const PLAIN_TPL = {
  id: "55555555-5555-4555-8555-555555555555", name: "Rental Agreement", version: 2, is_active: true, approval_status: "approved",
  body: "VEHICLE RENTAL AGREEMENT\nRenter: {{driver_name}}\nVehicle: {{vehicle}}\nWeekly rental rate: {{weekly_rate}}\nSecurity deposit: {{deposit_amount}}",
};
const tables = () => ({
  applications: [{ ...APP }], vehicles: [{ ...VEHICLE }], markets: [], app_settings: [], agreement_templates: [{ ...PLAIN_TPL }],
  rentals: [{ id: "r1", application_id: APP_ID, status: "active", start_date: "2026-10-01", end_date: null, vehicle_id: VEH_ID, created_at: "2026-10-01" }],
});

console.log("\nan updated agreement prints the proposed rate and changes nothing on file");
const t = tables();
const before = JSON.stringify(t);
const amended = await AG.amendmentSendCheck(fakeAdmin(t), APP_ID, { weeklyRate: 375, notice: "Amendment notice.", vehicleId: VEH_ID });
ok(amended.weeklyRate === 375, `prints $375/week (got ${amended.weeklyRate})`);
ok(!amended.blockers.some((b) => b.field === "weekly_rate"), "no weekly-rate blocker");
ok(!amended.blockers.some((b) => b.field === "vehicle"), "names the active rental's car");
ok(amended.vehicleLabel === "2020 Ford Fusion SE", `vehicle label (got ${amended.vehicleLabel})`);
ok(JSON.stringify(t) === before && writes.length === 0, `nothing is written: the application, rental and vehicle keep $350 until signing (writes: ${JSON.stringify(writes)})`);
const plain = await AG.agreementSendCheck(fakeAdmin(tables()), APP_ID);
ok(plain.weeklyRate === 350, `without an amendment the agreement still prints $350 (got ${plain.weeklyRate})`);

console.log("\nno Reservation Fee, no new deposit, nothing due now");
ok(/Weekly rental rate: \$375/.test(amended.body), "the agreement body prints $375/week");
ok(amended.body.includes("Amendment notice."), "with the amendment notice");
ok(/Security deposit: \$0 \(no new deposit; rental already active\)/.test(amended.body), "deposit line: $0, no new deposit");
ok(!/\$50\b/.test(amended.body) && !amended.merge.reservation, "no $50 / Reservation Fee amount anywhere");
ok(!amended.blockers.length, `no blockers (${JSON.stringify(amended.blockers)})`);

// A saved template that prints a Reservation Fee row and money rows (v1.10+/v1.14 style).
const FEE_TPL = {
  id: "44444444-4444-4444-8444-444444444444", name: "Rental Agreement", version: 3, is_active: true, approval_status: "approved",
  body: "Weekly: {{weekly_rate}}\nDeposit: {{deposit_amount}}\nReservation Fee: [[reservation_line]]\nAmount Due Each Payment: {{payment_amount}}\nBalance Due At Pickup: {{balance_due}}\n%%BUILDER_TERMS " + JSON.stringify({ reservation_line: "[ ] Required: $______  [ ] Not Required" }) + "%%",
};
const ft = tables(); ft.agreement_templates = [FEE_TPL];
const PREP = RA.amendmentPrep(null, { damageWaiver: "declined", paymentSchedule: "weekly", paymentMethod: "Card Autopay" });
const fee = await AG.amendmentSendCheck(fakeAdmin(ft), APP_ID, { weeklyRate: 375, notice: "N", vehicleId: VEH_ID, prep: PREP });
ok(/Reservation Fee: Not applicable \(rental already active\)/.test(fee.body), `fee template: Reservation Fee row says not applicable (${(fee.body.match(/Reservation Fee:.*/) || [""])[0]})`);
ok(/Balance Due At Pickup: \$0\.00 \(rental already active\)/.test(fee.body), "fee template: nothing due now");
ok(/Amount Due Each Payment: \$375/.test(fee.body), "fee template: each payment is the new weekly rate");
ok(!/\[ \] Required/.test(fee.body) && !fee.blockers.some((b) => b.field === "reservation_fee"), "no Required/Not Required checkboxes, no fee blocker");

console.log("\nv1.14 (the live template): updated agreement, no Reservation Fee");
// The agreement being amended was a v1.14 send WITH the $50 Reservation Fee.
const PREV_PREP = JSON.stringify({ drivers: { mode: "none", list: [] }, reservation: { mode: "required", amount: 50 }, deposit: { mode: "required", amount: 200, reason: "" },
  damageWaiver: "declined", payment: { schedule: "weekly", method: "Card Autopay" }, vehicleOwner: "REAL RENTALS LLC" });
const v114prep = RA.amendmentPrep(PREV_PREP, {});
ok(v114prep.reservation.mode === "not_required" && v114prep.reservation.amount == null, "carried-over prep: Reservation Fee forced to not required");
ok(v114prep.deposit.mode === "none", "carried-over prep: no deposit");
ok(v114prep.damageWaiver === "declined" && v114prep.payment.method === "Card Autopay" && v114prep.vehicleOwner === "REAL RENTALS LLC", "v1.14 choices carry over from the signed agreement");
const vt = tables();
const v = await AG.amendmentSendCheck(fakeAdmin(vt), APP_ID, { weeklyRate: 375, notice: "Amendment notice.", vehicleId: VEH_ID, prep: v114prep, templateKey: RA.AMENDMENT_TEMPLATE_KEY });
const row = (label) => ((v.body.split("\n").find((l) => l.startsWith(`| ${label}`)) || "").split("|")[2] || "").trim();
ok(/Weekly Rate[^\n]*\$375/.test(v.body), "v1.14 prints the new $375 Weekly Rate");
ok(row("Reservation Fee (Applied To First Payment)") === "Not applicable (rental already active)", `v1.14 Reservation Fee row: not applicable (got "${row("Reservation Fee (Applied To First Payment)")}")`);
ok(row("Balance Due") === "$0.00 (rental already active)", `v1.14 Balance Due: $0.00 (got "${row("Balance Due")}")`);
ok(/^\$375\.00 weekly/.test(row("Amount Due Each Payment (Weekly or Every 4 Weeks)")), `v1.14 each payment: $375.00 weekly (got "${row("Amount Due Each Payment (Weekly or Every 4 Weeks)")}")`);
ok(!/\|[^|\n]*\$50\.00/.test(v.body.split("## 3")[0]) && !/Required: \$50/.test(v.body), "no $50 Reservation Fee amount on page 1");
ok(v.body.includes("**Amendment.** Amendment notice."), "v1.14 shows the amendment box");
// v1.14 is Owner-approved for sending (#405, t319u).
ok(!v.blockers.length, `v1.14 has no blockers (${JSON.stringify(v.blockers)})`);
ok(writes.length === 0, "still nothing written");
const forced = await AG.amendmentSendCheck(fakeAdmin(tables()), APP_ID, { weeklyRate: 375, notice: "N", vehicleId: VEH_ID, templateKey: RA.AMENDMENT_TEMPLATE_KEY,
  prep: { ...v114prep, reservation: { mode: "required", amount: 50 }, deposit: { mode: "required", amount: 200, reason: "" } } });
ok(!/Required: \$50/.test(forced.body) && !forced.blockers.some((b) => b.field === "reservation_fee" || b.field === "deposit_amount"), "a fee or deposit slipped into the prep is still dropped");
const nc = tables(); nc.applications[0].card_brand = null; nc.applications[0].card_last4 = null;
const noCard = await AG.amendmentSendCheck(fakeAdmin(nc), APP_ID, { weeklyRate: 375, notice: "N", vehicleId: VEH_ID, prep: v114prep, templateKey: RA.AMENDMENT_TEMPLATE_KEY });
ok(!noCard.blockers.length && noCard.body.includes("Saved at next payment"), `no card on file: prints "Saved at next payment", no blocker (${JSON.stringify(noCard.blockers)})`);
const plainNoCard = await AG.agreementSendCheck(fakeAdmin(nc), APP_ID);
ok(!plainNoCard.body?.includes("Saved at next payment"), "a first-time agreement never gets the next-payment card line");
const unknown = await AG.amendmentSendCheck(fakeAdmin(tables()), APP_ID, { weeklyRate: 375, notice: "N", vehicleId: VEH_ID, prep: RA.amendmentPrep(null, {}), templateKey: RA.AMENDMENT_TEMPLATE_KEY });
ok(unknown.blockers.some((b) => b.field === "damage_waiver") && unknown.blockers.some((b) => b.field === "payment_method"), "nothing guessed: an older agreement without v1.14 choices blocks until they are given");

let threw = "";
try { await AG.amendmentSendCheck(fakeAdmin(tables()), APP_ID, { weeklyRate: 375, notice: "N", vehicleId: "33333333-3333-4333-8333-333333333333" }); } catch (e) { threw = String(e?.message ?? e); }
ok(threw.length > 0, `a car that is not the active rental's is refused (${threw.slice(0, 80)})`);

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall pass");
process.exit(fail ? 1 : 0);
