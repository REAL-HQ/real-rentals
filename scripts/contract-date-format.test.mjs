/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   DATES PRINTED INSIDE A RENTAL AGREEMENT ARE MM-DD-YYYY, AND THEY ARE
 *   FORMATTED BY THE CONTRACT FORMATTER — NEVER BY THE APPLICATION'S
 *   DISPLAY HELPER. CHANGING HOW THE DASHBOARD SHOWS A DATE MUST NOT BE
 *   ABLE TO CHANGE CONTRACT WORDING OR AN AGREEMENT FINGERPRINT.
 *
 * The regression. `buildMergeData` and `applyPrep` formatted six contract
 * fields with `fmtDate` from @/lib/date-format — the app-wide display helper:
 * the start date, the return date, the renter's date of birth, the execution
 * date, the minimum-term end and an additional driver's licence expiry.
 *
 * When that helper changed from "10-11-2026" to "Oct 11, 2026", the AGREEMENT
 * TEXT changed with it. No template edit, no new version, no Owner approval —
 * and because the rendered body feeds the preview SHA-256, the fingerprint
 * moved too. The sibling file (contract-min-term) covers the other half of the
 * same bug, where a CALCULATION read a rendered string.
 *
 * Contract wording changes only through an Owner-approved template version.
 * So contract text formats its dates in agreement-dates.ts, which imports
 * nothing from the UI formatter, and this file drives the real modules to
 * prove it — the merge data, the rendered body and the fingerprint.
 *
 * Pure functions and a fake PostgREST. No database, no network.
 *
 * Run: node scripts/contract-date-format.test.mjs   (npm run test:contract-dates)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".contract-dates-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

writeFileSync(`${OUT}/stub-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
writeFileSync(`${OUT}/stub-start-server.js`, `
export const getRequest = () => ({ headers: new Map() });
export const getRequestHeader = () => null;
`);
writeFileSync(`${OUT}/stub-auth.js`, `export const requireSupabaseAuth = {};`);
/*
 * The Supabase stub IS the fixture database: previewAgreement imports
 * supabaseAdmin itself rather than taking one, so the rows have to arrive
 * this way. Just enough PostgREST to answer buildMergeData's reads.
 */
writeFileSync(`${OUT}/stub-sb.js`, `
const T = () => globalThis.__cdf ?? {};
function table(name) {
  const filters = []; let cap;
  const rows = () => {
    const all = (T()[name] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    return cap == null ? all : all.slice(0, cap);
  };
  const api = {
    select: () => api,
    eq: (c, v) => (filters.push([c, v]), api),
    order: () => api,
    limit: (n) => ((cap = n), api),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return api;
}
export const supabaseAdmin = { from: table };
export const supabase = supabaseAdmin;
export default supabaseAdmin;
`);
writeFileSync(`${OUT}/stub-roles.js`, `
export const requireTier = async () => ({ tier: "admin", userId: "owner" });
export const requireTierFor = requireTier;
export const requireStaff = requireTier;
export const requireManager = requireTier;
export const requireOwner = requireTier;
export const getActor = async () => ({ tier: "admin" });
export const tierAllows = () => true;
`);

const bundle = (src, out, aliases = false) => execFileSync("npx", [
  "esbuild", src, "--bundle", "--platform=node", "--format=esm",
  `--outfile=${OUT}/${out}`, "--alias:@=./src",
  ...(aliases ? [
    `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
    `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
    `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
    `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`,
    `--alias:@/lib/roles.server=./${OUT}/stub-roles.js`,
  ] : []),
], { stdio: ["ignore", "ignore", "inherit"] });

bundle("src/lib/agreement-dates.ts", "dates.mjs");
bundle("src/lib/agreement-prep.ts", "prep.mjs");
bundle("src/lib/date-format.ts", "fmt.mjs");
bundle("src/lib/agreements.functions.ts", "ag.mjs", true);
const D = await import(`../${OUT}/dates.mjs`);
const P = await import(`../${OUT}/prep.mjs`);
const F = await import(`../${OUT}/fmt.mjs`);
const AGMOD = await import(`../${OUT}/ag.mjs`);

// ============================================ 1. the formatter itself
console.log("\na contract date is MM-DD-YYYY");
for (const [input, want] of [
  ["2026-10-11", "10-11-2026"],
  ["2028-01-01", "01-01-2028"],
  ["2026-01-05", "01-05-2026"],   // both parts padded
  ["2026-12-31", "12-31-2026"],
  ["2028-02-29", "02-29-2028"],   // leap day
]) ok(D.fmtContractDate(input) === want, `${input} -> ${D.fmtContractDate(input)} (want ${want})`);

console.log("\nit refuses to guess");
for (const bad of ["", "not a date", null, undefined, {}, "2026-13-45x", NaN])
  ok(D.fmtContractDate(bad) === "", `${JSON.stringify(bad)} -> "" rather than an invented date`);

console.log("\na date-only value does not move by timezone");
{
  // The 11th of October is the 11th wherever the reader is sitting. Run the
  // same value under an eastern and a western zone offset.
  const tz = process.env.TZ;
  const seen = new Set();
  for (const z of ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "America/New_York"]) {
    process.env.TZ = z;
    seen.add(D.fmtContractDate("2026-10-11"));
  }
  process.env.TZ = tz;
  ok(seen.size === 1 && seen.has("10-11-2026"), `one answer in every zone (${[...seen].join(", ")})`);
}

console.log("\nthe execution date is the local calendar day it was signed");
{
  const d = new Date(2026, 9, 11, 20, 30); // 11 Oct, 8:30pm local
  ok(D.fmtContractDate(d) === "10-11-2026",
    `an evening instant prints its own day, not tomorrow's UTC one (${D.fmtContractDate(d)})`);
}

// ============================ 2. additional-driver licence expiration
console.log("\nan additional driver's licence expiry prints as a contract date");
const ctx = { startIso: "2026-10-12", depositClause: "There is no security deposit." };
const drv = { name: "Sam Q Helper", licenseNumber: "h123", licenseState: "fl", licenseExpiration: "2028-01-01", verified: true };
{
  const r = P.applyPrep({ ...P.EMPTY_PREP, drivers: { mode: "listed", list: [drv] } }, ctx);
  ok(r.merge.additional_drivers === "Sam Q Helper (FL DL H123, exp. 01-01-2028)",
    `prints exp. 01-01-2028 (${r.merge.additional_drivers})`);
  ok(!r.merge.additional_drivers.includes("Jan"), "  and no month name reaches the contract");
  ok(!r.blockers.length, "  with nothing blocking a complete driver");
}
{
  // The staff-facing refusal names the same date in the same format, so what
  // the reviewer reads and what the contract prints cannot disagree.
  const r = P.applyPrep({ ...P.EMPTY_PREP, drivers: { mode: "listed", list: [{ ...drv, licenseExpiration: "2026-10-01" }] } }, ctx);
  const why = r.blockers.map((b) => b.why).join(" ");
  ok(/10-01-2026/.test(why), `the expiry blocker names the date the same way (${why})`);
}

// ====================================== 3. agreement body rendering
console.log("\nthe rendered agreement body carries contract dates");
function fakeAdmin(tables) {
  return {
    from(name) {
      const filters = [];
      let cap;
      const rows = () => {
        const all = (tables[name] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
        return cap == null ? all : all.slice(0, cap);
      };
      const api = {
        select: () => api,
        eq: (c, v) => (filters.push([c, v]), api),
        order: () => api,
        limit: (n) => ((cap = n), api),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return api;
    },
  };
}

const APP_ID = "11111111-1111-4111-8111-111111111111";
const VEH_ID = "22222222-2222-4222-8222-222222222222";
const APP = {
  id: APP_ID, full_name: "Dana Reyes", email: "dana@example.com", phone: "813-555-0142",
  address: "1200 N Ashley Dr", city: "Tampa", state: "FL", zip: "33602",
  license_number: "R123-456-78-901-0", license_state: "FL", license_expiration: "2030-04-30",
  vehicle_id: VEH_ID, weekly_rent: 329, deposit_amount: 0, market_id: null,
  dob: "1991-07-02", card_brand: "visa", card_last4: "4242",
  insurance_carrier: "Progressive", insurance_policy_number: "PP-99812",
  contract_start_date: "2026-10-11", contract_end_date: "2027-04-11",
};
const VEHICLE = {
  id: VEH_ID, year: 2023, make: "Toyota", model: "Camry", trim: "LE", color: "Silver",
  vin: "1HGCM82633A004352", unit_number: "14", weekly_rate: 329, deposit: 0,
  license_plate: "ABC1234", plate_state: "FL",
};
/**
 * A template that prints every date field under test. No minimum term, so
 * min_term_end is covered separately below rather than blocking this one.
 */
const TEMPLATE = {
  id: "33333333-3333-4333-8333-333333333333", name: "Rental Agreement", version: 1, is_active: true,
  body: "Starts {{start_date}}, returns {{return_date}}. Born {{driver_dob}}. Executed {{today}}.",
};
const FIXTURES = {
  applications: [APP], vehicles: [VEHICLE], rentals: [], markets: [],
  app_settings: [], agreement_templates: [TEMPLATE],
};
const admin = () => fakeAdmin(FIXTURES);
globalThis.__cdf = FIXTURES;

// The real generation step, through the exported server function: it calls
// prepareAgreement -> buildMergeData -> renderTemplate and hands back the
// merge fields, the rendered body and the fingerprint Send re-checks.
const preview = await AGMOD.previewAgreement({ data: { applicationId: APP_ID }, context: { userId: "owner" } });
const data = preview.merge;
for (const [field, want] of [
  ["start_date", "10-11-2026"],
  ["return_date", "04-11-2027"],
  ["driver_dob", "07-02-1991"],
]) ok(data[field] === want, `${field} = ${JSON.stringify(data[field])} (want ${want})`);
ok(/^\d{2}-\d{2}-\d{4}$/.test(String(data.today)), `today is a contract date (${data.today})`);

console.log("\nthe rendered body prints those dates, not month names");
{
  const body = String(preview.body ?? "");
  ok(body.includes("Starts 10-11-2026"), `the body prints the start date (${body.slice(0, 60)})`);
  ok(body.includes("returns 04-11-2027"), "  the return date");
  ok(body.includes("Born 07-02-1991"), "  the date of birth");
  ok(!/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}/.test(body),
    "  and no month-name date survives anywhere in the contract text");
  ok(preview.canSend === true, "  and the agreement is sendable, so this is the text that would go out");
}

console.log("\nno month name reaches any merge field");
{
  const blob = JSON.stringify(data);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hit = MONTHS.filter((m) => new RegExp(`${m} \\d{1,2}, \\d{4}`).test(blob));
  ok(hit.length === 0, `no "Mon D, YYYY" anywhere in the merge data${hit.length ? ": " + hit.join(", ") : ""}`);
}

console.log("\nthe minimum-term end date renders as a contract date");
{
  const body = "Minimum term ends {{min_term_end}}.\n%%BUILDER_TERMS " +
    JSON.stringify({ min_term_weeks: "4 weeks" }) + "%%";
  const d2 = { start_date: "10-11-2026", min_term_end: "" };
  AGMOD.templateFieldBlockers(body, d2, [], null, null, "2026-10-11");
  ok(d2.min_term_end === "11-08-2026", `min_term_end = ${JSON.stringify(d2.min_term_end)} (want 11-08-2026)`);
}

// ================================= 4. the preview fingerprint is stable
console.log("\nthe fingerprint follows the contract text, not the dashboard");
{
  // Two previews of the same application must agree. The fingerprint is what
  // Send re-checks, so a date that formatted differently between preview and
  // send would refuse every send with a mismatch.
  const b = await AGMOD.previewAgreement({ data: { applicationId: APP_ID }, context: { userId: "owner" } });
  ok(/^[0-9a-f]{64}$/.test(String(preview.fingerprint)), `the preview carries a fingerprint (${preview.fingerprint})`);
  ok(preview.fingerprint === b.fingerprint, "two previews of one application produce the same fingerprint");
  ok(preview.body === b.body, "  and the same rendered body");
}
{
  // The point of the fix, stated as a test: the contract formatter does not
  // consult the UI one, so the UI one can be changed without moving a
  // fingerprint. If this ever fails, contract text has been re-coupled to
  // display and an approved template's wording can move underneath it.
  const src = readFileSync("src/lib/agreement-dates.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(!/date-format/.test(src), "agreement-dates.ts imports nothing from the UI date module");
  ok(!/fmtDate\b/.test(src), "  and calls no fmtDate");
  for (const f of ["src/lib/agreements.functions.ts", "src/lib/agreement-prep.ts"]) {
    const c = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(!/from "@\/lib\/date-format"/.test(c), `${f.replace("src/lib/", "")} does not import the UI formatter`);
    ok(!/\bfmtDate\(/.test(c), `  and formats no contract field with it`);
  }
  ok(F.fmtDate("2026-10-11") === "Oct 11, 2026",
    `the dashboard keeps its own format, untouched (${F.fmtDate("2026-10-11")})`);
}

// ======================== 5. signed agreements are not touched by any of this
console.log("\nalready-signed agreements keep the words they were signed with");
{
  // A signed agreement's body, sha256 and signed_at are frozen columns on the
  // row. Nothing in this change reads, re-renders or rewrites them: the
  // formatter is only ever called while BUILDING merge data for a new
  // preview. These two assertions pin that — no write path to a signed body,
  // and no re-render on read.
  const ag = readFileSync("src/lib/agreements.functions.ts", "utf8");
  ok(!/update\(\s*\{[^}]*\bbody\s*:/.test(ag.replace(/\n/g, " ")),
    "no code path updates the body column of an existing agreement");
  const listFn = ag.slice(ag.indexOf("export const listAgreements"));
  const listBody = listFn.slice(0, listFn.indexOf("\n  });"));
  ok(!/fmtContractDate|buildMergeData|renderTemplate/.test(listBody),
    "reading agreement history re-formats and re-renders nothing");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall contract date format checks pass");
process.exit(fail ? 1 : 0);
