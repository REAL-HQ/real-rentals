/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   DATES PRINTED INSIDE A RENTAL AGREEMENT READ "Oct 11, 2026" (THE OWNER'S
 *   DECISION, AND EXACTLY WHAT RELEASE A PRINTED), FORMATTED BY THE CONTRACT
 *   FORMATTER (agreement-dates.ts), NEVER BY THE APP'S DISPLAY HELPER.
 *   CANONICAL VALUES STAY ISO (YYYY-MM-DD) IN merge INPUTS AND THE DATABASE.
 *
 *   THE EXECUTION DATE ({{today}}) IS THE BUSINESS CALENDAR DAY IN
 *   AMERICA/NEW_YORK, NOT THE SERVER'S UTC DAY — SO A PREVIEW AND ITS SEND ON
 *   THE SAME EASTERN DAY HAVE THE SAME FINGERPRINT, ACROSS MIDNIGHT UTC.
 *
 * The regression (Release A). buildMergeData formatted contract dates with
 * fmtDate from @/lib/date-format, and computed `today` as fmtDate(new Date())
 * on a server running in UTC. `today` is part of the preview fingerprint, so a
 * preview reviewed at 7:59pm EDT (23:59 UTC) refused to Send at 8:01pm EDT
 * (00:01 UTC), and any evening signing printed tomorrow's date. Structure
 * ported from e208920d (fmtContractDate), instants read in America/New_York,
 * output kept identical to Release A's wording — section 6 proves that against
 * Release A's own source (14cbf81b) for date-only values in daytime UTC.
 *
 * Drives the real modules through the exported previewAgreement and
 * issueAgreement with a fake PostgREST and a fake clock. No database, no
 * network.
 *
 * Run: node scripts/contract-date-format.test.mjs   (npm run test:contract-dates)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Release A read instants in the server's zone, which is UTC in production.
// Pin it so the Release A comparison below is the production comparison.
process.env.TZ = "UTC";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".contract-dates-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Nothing in this file may leave the machine.
globalThis.fetch = async (u) => { throw new Error(`contract-date-format: network refused (${u})`); };
delete process.env.RESEND_API_KEY;

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
writeFileSync(`${OUT}/stub-sb.js`, `
export const supabaseAdmin = { from: (n) => globalThis.__fx.from(n) };
export const supabase = supabaseAdmin;
export default supabaseAdmin;
`);
writeFileSync(`${OUT}/stub-roles.js`, `
export const requireTier = async () => ({ tier: "owner", userId: "owner" });
export const requireStaff = requireTier;
export const requireManager = requireTier;
export const requireOwner = requireTier;
export const getActor = async () => null;
`);
writeFileSync(`${OUT}/stub-email.js`, `
export const sendAgreementEmail = async () => ({ ok: false, error: "capture-only" });
export const sendAgreementSignedEmail = async () => {};
export const sendAgreementSignedOpsEmail = async () => {};
`);
writeFileSync(`${OUT}/stub-sms.js`, `export const sendSms = async () => ({ ok: false, skipped: true, reason: "capture_only" });`);

const bundle = (src, out, aliases = false) => execFileSync("npx", [
  "esbuild", src, "--bundle", "--platform=node", "--format=esm",
  `--outfile=${OUT}/${out}`, "--alias:@=./src",
  ...(aliases ? [
    `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
    `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
    `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
    `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`,
    `--alias:@/lib/roles.server=./${OUT}/stub-roles.js`,
    `--alias:@/lib/email.server=./${OUT}/stub-email.js`,
    `--alias:@/lib/sms.server=./${OUT}/stub-sms.js`,
  ] : []),
], { stdio: ["ignore", "ignore", "inherit"] });

bundle("src/lib/agreement-dates.ts", "dates.mjs");
bundle("src/lib/agreement-prep.ts", "prep.mjs");
bundle("src/lib/date-format.ts", "fmt.mjs");
bundle("src/lib/agreements.functions.ts", "ag.mjs", true);
// Release A's own source, unmodified, for the wording comparison (section 6).
// Its agreements module resolves every other import against this tree, but
// its date formatter and its prep module are Release A's.
const RA = "14cbf81b";
mkdirSync(`${OUT}/ra`, { recursive: true });
for (const f of ["date-format.ts", "agreement-prep.ts", "agreements.functions.ts"])
  writeFileSync(`${OUT}/ra/${f}`, execFileSync("git", ["show", `${RA}:src/lib/${f}`], { encoding: "utf8" }));
execFileSync("npx", [
  "esbuild", `${OUT}/ra/date-format.ts`, "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/ra-fmt.mjs`,
], { stdio: ["ignore", "ignore", "inherit"] });
execFileSync("npx", [
  "esbuild", `${OUT}/ra/agreements.functions.ts`, "--bundle", "--platform=node", "--format=esm",
  `--outfile=${OUT}/ra-ag.mjs`, "--alias:@=./src",
  `--alias:@/lib/date-format=./${OUT}/ra/date-format.ts`,
  `--alias:@/lib/agreement-prep=./${OUT}/ra/agreement-prep.ts`,
  `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
  `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub-roles.js`,
  `--alias:@/lib/email.server=./${OUT}/stub-email.js`,
  `--alias:@/lib/sms.server=./${OUT}/stub-sms.js`,
], { stdio: ["ignore", "ignore", "inherit"] });
const RAF = await import(`../${OUT}/ra-fmt.mjs`);
const RAAG = await import(`../${OUT}/ra-ag.mjs`);
{
  const raSrc = readFileSync(`${OUT}/ra/agreements.functions.ts`, "utf8");
  if (!/today: fmtDate\(new Date\(\)\)/.test(raSrc) || /fmtContractDate/.test(raSrc))
    throw new Error("the Release A baseline is not the expected source");
}
const D = await import(`../${OUT}/dates.mjs`);
const P = await import(`../${OUT}/prep.mjs`);
const F = await import(`../${OUT}/fmt.mjs`);
const AG = await import(`../${OUT}/ag.mjs`);

// ------------------------------------------------------------ fake clock
const RealDate = Date;
async function at(iso, fn) {
  const fixed = new RealDate(iso).getTime();
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  }
  globalThis.Date = FakeDate;
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}

// ------------------------------------------------------- fake PostgREST
function fakeDb(tables) {
  const inserted = [];
  const from = (name) => {
    const filters = [];
    let cap; let op = "select"; let payload = null;
    const rows = () => {
      const all = (tables[name] ?? []).filter((r) => filters.every((f) => f(r)));
      return cap == null ? all : all.slice(0, cap);
    };
    const result = () => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({ id: r.id ?? `00000000-0000-4000-8000-${String(inserted.length + i + 1).padStart(12, "0")}`, ...r }));
        (tables[name] ??= []).push(...list);
        inserted.push(...list.map((r) => ({ table: name, row: r })));
        return list;
      }
      if (op === "update") { const hit = rows(); for (const r of hit) Object.assign(r, payload); return hit; }
      return rows();
    };
    const api = {
      select: () => api,
      insert: (v) => ((op = "insert"), (payload = v), api),
      update: (v) => ((op = "update"), (payload = v), api),
      eq: (c, v) => (filters.push((r) => r[c] === v), api),
      neq: (c, v) => (filters.push((r) => r[c] !== v), api),
      in: (c, v) => (filters.push((r) => v.includes(r[c])), api),
      is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), api),
      order: () => api,
      limit: (n) => ((cap = n), api),
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      single: async () => ({ data: result()[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve({ data: result(), error: null }).then(res, rej),
    };
    return api;
  };
  return { from, inserted, rpc: async () => ({ data: null, error: null }) };
}

const APP_ID = "11111111-1111-4111-8111-111111111111";
const VEH_ID = "22222222-2222-4222-8222-222222222222";
const APP = {
  id: APP_ID, full_name: "Dana Reyes", email: "dana@example.invalid", phone: "813-555-0142",
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
const TEMPLATE = {
  id: "33333333-3333-4333-8333-333333333333", name: "Rental Agreement", version: 1, is_active: true,
  body: "Starts {{start_date}}, returns {{return_date}}. Born {{driver_dob}}. Executed {{today}}.",
};
const fixtures = () => ({
  applications: [{ ...APP }], vehicles: [{ ...VEHICLE }], rentals: [], markets: [],
  app_settings: [], agreement_templates: [{ ...TEMPLATE }], agreements: [], esign_recipients: [], audit_log: [],
});
const freshDb = () => (globalThis.__fx = fakeDb(fixtures()));
const preview = (db) => AG.previewAgreement({ data: { applicationId: APP_ID }, context: { userId: "owner" } }).then((p) => (void db, p));

// ============================================ 1. the formatter itself
console.log("\na contract date reads Mon D, YYYY");
for (const [input, want] of [
  ["2026-10-11", "Oct 11, 2026"], ["2027-02-03", "Feb 3, 2027"], ["2028-01-01", "Jan 1, 2028"],
  ["2026-01-05", "Jan 5, 2026"], ["2026-12-31", "Dec 31, 2026"], ["2028-02-29", "Feb 29, 2028"],
]) ok(D.fmtContractDate(input) === want, `${input} -> ${D.fmtContractDate(input)} (want ${want})`);

console.log("\nit refuses to guess");
for (const bad of ["", "   ", "not a date", null, undefined, {}, "2026-13-45x", NaN, "2026-02-30"])
  ok(D.fmtContractDate(bad) === "", `${JSON.stringify(bad)} -> "" rather than an invented date`);

console.log("\nthe business timezone is Eastern");
ok(D.CONTRACT_TIME_ZONE === "America/New_York", `CONTRACT_TIME_ZONE = ${D.CONTRACT_TIME_ZONE}`);

console.log("\nan instant prints its Eastern calendar day, whatever zone the server runs in");
{
  const probe = `
import * as D from "../${OUT}/dates.mjs";
console.log(JSON.stringify([
  D.fmtContractDate(new Date("2026-10-25T23:59:00Z")),  // 7:59pm EDT
  D.fmtContractDate(new Date("2026-10-26T00:01:00Z")),  // 8:01pm EDT, next UTC day
  D.fmtContractDate(new Date("2026-10-26T03:59:00Z")),  // 11:59pm EDT
  D.fmtContractDate(new Date("2026-10-26T04:01:00Z")),  // 12:01am EDT
  D.fmtContractDate(new Date("2026-12-15T04:59:00Z")),  // 11:59pm EST
  D.fmtContractDate(new Date("2026-12-15T05:01:00Z")),  // 12:01am EST
  D.fmtContractDate("2026-10-11"),                      // date-only never moves
]));
`;
  writeFileSync(`${OUT}/probe.mjs`, probe);
  const want = ["Oct 25, 2026", "Oct 25, 2026", "Oct 25, 2026", "Oct 26, 2026", "Dec 14, 2026", "Dec 15, 2026", "Oct 11, 2026"];
  for (const tz of ["UTC", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata"]) {
    const out = execFileSync("node", [`${OUT}/probe.mjs`], { encoding: "utf8", env: { ...process.env, TZ: tz } });
    const got = JSON.parse(out.trim().split("\n").pop());
    ok(JSON.stringify(got) === JSON.stringify(want), `server TZ=${tz}: ${got.join(", ")}`);
  }
}

console.log("\na Date from another JS realm is still a date");
{
  // agreement-evidence.test.cjs loads each module in its own vm context, so
  // `new Date()` in agreements.functions.ts is not `instanceof Date` inside
  // agreement-dates.ts. The execution date must not blank out there.
  const foreign = runInNewContext('new Date("2026-10-26T00:01:00Z")');
  ok(!(foreign instanceof Date), "the probe really is a foreign-realm Date");
  ok(D.fmtContractDate(foreign) === "Oct 25, 2026", `it prints its Eastern day (${D.fmtContractDate(foreign)})`);
}

// ============================ 2. additional-driver licence expiration
console.log("\nan additional driver's licence expiry prints as a contract date");
const ctx = { startIso: "2026-10-12", depositClause: "There is no security deposit." };
const drv = { name: "Sam Q Helper", licenseNumber: "h123", licenseState: "fl", licenseExpiration: "2028-01-01", verified: true };
{
  const r = P.applyPrep({ ...P.EMPTY_PREP, drivers: { mode: "listed", list: [drv] } }, ctx);
  ok(r.merge.additional_drivers === "Sam Q Helper (FL DL H123, exp. Jan 1, 2028)", `prints exp. Jan 1, 2028 (${r.merge.additional_drivers})`);
  ok(!r.blockers.length, "  with nothing blocking a complete driver");
}
{
  const r = P.applyPrep({ ...P.EMPTY_PREP, drivers: { mode: "listed", list: [{ ...drv, licenseExpiration: "2026-10-01" }] } }, ctx);
  ok(/Oct 1, 2026/.test(r.blockers.map((b) => b.why).join(" ")), "the expiry blocker names the date the same way");
}

// ====================================== 3. merge data and rendered body
console.log("\nthe rendered agreement body carries contract dates");
const p1 = await at("2026-10-25T16:00:00Z", () => preview(freshDb()));
for (const [field, want] of [["start_date", "Oct 11, 2026"], ["return_date", "Apr 11, 2027"], ["driver_dob", "Jul 2, 1991"], ["today", "Oct 25, 2026"]])
  ok(p1.merge[field] === want, `${field} = ${JSON.stringify(p1.merge[field])} (want ${want})`);
ok(String(p1.body).includes("Starts Oct 11, 2026") && String(p1.body).includes("Executed Oct 25, 2026"), "the body prints those dates");
ok(!/\b\d{2}-\d{2}-\d{4}\b/.test(String(p1.body) + JSON.stringify(p1.merge)),
  "no MM-DD-YYYY date reaches the contract or its merge data");
ok(p1.canSend === true, "the preview is sendable, so this is the text that would go out");

// ============================ 4. fingerprint stability across midnight UTC
console.log("\nthe preview fingerprint is stable across 23:59 -> 00:01 UTC on the same Eastern day");
{
  const before = await at("2026-10-25T23:59:00Z", () => preview(freshDb()));
  const after = await at("2026-10-26T00:01:00Z", () => preview(freshDb()));
  ok(before.merge.today === "Oct 25, 2026" && after.merge.today === "Oct 25, 2026",
    `{{today}} is Oct 25, 2026 both times (${before.merge.today}, ${after.merge.today}) — not tomorrow's UTC date`);
  ok(/^[0-9a-f]{64}$/.test(String(before.fingerprint)), "the preview carries a fingerprint");
  ok(before.fingerprint === after.fingerprint, "the fingerprint is identical across midnight UTC");
  ok(before.body === after.body, "  and so is the rendered body");
}
{
  // Control: the date really is in the fingerprint, and the boundary that
  // moves it is midnight EASTERN (EST in December: 05:00 UTC).
  const before = await at("2026-12-15T04:59:00Z", () => preview(freshDb()));
  const after = await at("2026-12-15T05:01:00Z", () => preview(freshDb()));
  ok(before.merge.today === "Dec 14, 2026" && after.merge.today === "Dec 15, 2026",
    `across midnight Eastern the execution date moves (${before.merge.today} -> ${after.merge.today})`);
  ok(before.fingerprint !== after.fingerprint, "  and the fingerprint moves with it, so Send asks for a fresh review");
}

console.log("\nSend after midnight UTC accepts a preview reviewed before it");
{
  const db = freshDb();
  const reviewed = await at("2026-10-25T23:59:00Z", () => preview(db));
  let err = null; let res = null;
  try {
    res = await at("2026-10-26T00:01:00Z", () => AG.issueAgreement(db, APP_ID, { fingerprint: reviewed.fingerprint, companyAck: true, createdBy: null }));
  } catch (e) { err = String(e?.message ?? e); }
  ok(!err, `issueAgreement accepted the 7:59pm EDT preview at 8:01pm EDT${err ? ` — refused: ${err}` : ""}`);
  const row = db.inserted.find((x) => x.table === "agreements")?.row;
  ok(row && row.body === reviewed.body, "  and stored exactly the reviewed text");
  ok(row?.metadata?.preview_fingerprint === reviewed.fingerprint, "  with the reviewed fingerprint recorded in metadata");
  ok(!!res?.url, "  and issued a signing link");
}
{
  const db = freshDb();
  const reviewed = await at("2026-12-15T04:59:00Z", () => preview(db));
  let err = "";
  try { await at("2026-12-15T05:01:00Z", () => AG.issueAgreement(db, APP_ID, { fingerprint: reviewed.fingerprint, companyAck: true })); }
  catch (e) { err = String(e?.message ?? e); }
  ok(/changed since it was previewed/.test(err), `a preview from the previous Eastern day is refused (${err.slice(0, 60)}…)`);
  ok(!db.inserted.some((x) => x.table === "agreements"), "  and nothing was inserted");
}

// ============================ 6. wording identical to Release A
console.log("\nfor date-only values the contract formatter prints exactly what Release A's fmtDate printed");
{
  const inputs = [];
  for (let m = 1; m <= 12; m++) for (const d of [1, 2, 9, 10, 15, 28]) inputs.push(`2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  inputs.push("2026-01-31", "2026-03-31", "2026-12-31", "2027-01-01", "2028-02-29", "1991-07-02", "2030-04-30", "2099-12-31", " 2026-10-11 ");
  const diff = inputs.filter((v) => D.fmtContractDate(v) !== RAF.fmtDate(v));
  ok(diff.length === 0, `${inputs.length} date-only inputs agree with Release A${diff.length ? ` — differ: ${diff.map((v) => `${v}: ${D.fmtContractDate(v)} vs ${RAF.fmtDate(v)}`).join("; ")}` : ""}`);
  ok(RAF.fmtDate("2027-02-03") === "Feb 3, 2027" && D.fmtContractDate("2027-02-03") === "Feb 3, 2027", "  e.g. Feb 3, 2027 both ways");
  // Instants in daytime UTC (the Eastern and UTC calendar days coincide).
  const instants = ["2026-10-25T12:00:00Z", "2026-10-25T16:00:00Z", "2026-12-15T15:30:00Z", "2027-03-14T18:00:00Z", "2028-02-29T13:00:00Z"];
  const idiff = instants.filter((v) => D.fmtContractDate(new Date(v)) !== RAF.fmtDate(new Date(v)));
  ok(idiff.length === 0, `${instants.length} daytime-UTC instants agree with Release A${idiff.length ? ` — differ: ${idiff.join(", ")}` : ""}`);
  // The only intended difference: an evening instant (after 8pm EDT).
  const eve = new Date("2026-10-26T00:30:00Z");
  ok(RAF.fmtDate(eve) === "Oct 26, 2026" && D.fmtContractDate(eve) === "Oct 25, 2026",
    `the timezone fix is the only change: 8:30pm EDT prints Oct 25, 2026 (Release A printed ${RAF.fmtDate(eve)})`);
  // Release A printed impossible date-only strings verbatim; a contract now blanks them so a blocker fires.
  ok(RAF.fmtDate("2026-02-30") === "Feb 30, 2026" && D.fmtContractDate("2026-02-30") === "",
    "an impossible date (2026-02-30) is refused instead of printed");
}

console.log("\nthe whole rendered agreement, merge data and fingerprint equal Release A's in daytime UTC");
{
  // A template printing every contract date field, with a minimum term and
  // an additional driver, rendered by THIS branch and by Release A's source.
  const TERMS = { min_term_weeks: "4 weeks" };
  const body = "Starts {{start_date}}, returns {{return_date}}. Born {{driver_dob}}. Executed {{today}}. " +
    "Minimum term ends {{min_term_end}}. Drivers: {{additional_drivers}}.\n%%BUILDER_TERMS " + JSON.stringify(TERMS) + "%%";
  const prep = {
    drivers: { mode: "listed", list: [{ name: "Marco Reyes", licenseNumber: "R999-111-22-333-0", licenseState: "FL", licenseExpiration: "2028-01-01", verified: true }] },
    reservation: { mode: "not_required", amount: null },
    deposit: { mode: "none", amount: null, reason: "" },
  };
  const db = () => {
    const t = fixtures();
    t.agreement_templates = [{ ...TEMPLATE, body }];
    return (globalThis.__fx = fakeDb(t));
  };
  for (const when of ["2026-10-25T16:00:00Z", "2026-12-15T15:00:00Z", "2027-02-03T14:00:00Z"]) {
    const ours = await at(when, () => (db(), AG.previewAgreement({ data: { applicationId: APP_ID, prep }, context: { userId: "owner" } })));
    const ra = await at(when, () => (db(), RAAG.previewAgreement({ data: { applicationId: APP_ID, prep }, context: { userId: "owner" } })));
    ok(ours.blockers.length === 0 && ra.blockers.length === 0 && ours.body != null, `${when}: both render with no blockers`);
    ok(ours.body === ra.body, `  the rendered body is byte-identical (${String(ours.body).split(". ")[3]})`);
    ok(JSON.stringify(ours.merge) === JSON.stringify(ra.merge), "  every merge field is identical");
    ok(ours.fingerprint === ra.fingerprint, "  and so is the preview fingerprint");
  }
}

// ======================================= 5. coupling checks
console.log("\ncontract text does not use the UI formatter");
{
  const strip = (f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const dates = strip("src/lib/agreement-dates.ts");
  ok(!/date-format/.test(dates) && !/fmtDate\b/.test(dates), "agreement-dates.ts imports nothing from the UI date module");
  for (const f of ["src/lib/agreements.functions.ts", "src/lib/agreement-prep.ts"]) {
    const c = strip(f);
    ok(!/from "@\/lib\/date-format"/.test(c) && !/\bfmtDate\(/.test(c), `${f.replace("src/lib/", "")} formats no contract field with fmtDate`);
  }
  ok(F.fmtDate("2026-10-11") === "Oct 11, 2026", `the dashboard keeps its own format (${F.fmtDate("2026-10-11")})`);
  const ag = readFileSync("src/lib/agreements.functions.ts", "utf8");
  ok(!/update\(\s*\{[^}]*\bbody\s*:/.test(ag.replace(/\n/g, " ")), "no code path rewrites the body of an existing agreement");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall contract date format checks pass");
process.exit(fail ? 1 : 0);
