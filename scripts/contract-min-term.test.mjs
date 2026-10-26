/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A DATE CALCULATION READS A DATE, NEVER A FORMATTED STRING.
 *   THE MINIMUM-TERM END DATE IS START + WEEKS*7, ACROSS ANY BOUNDARY.
 *   A DATE-ONLY VALUE IS A CALENDAR DATE AND DOES NOT MOVE BY TIMEZONE.
 *   AN ADDITIONAL DRIVER'S LICENCE MUST BE VALID ON THE START DATE.
 *   CHANGING HOW A DATE IS DISPLAYED MUST NOT CHANGE WHAT IT COMPUTES.
 *
 * The regression this exists for. buildMergeData renders the contract's start
 * date for the human, and two places then READ THAT RENDERED STRING back with
 *
 *     String(data.start_date).match(/^(\d{2})-(\d{2})-(\d{4})$/)
 *
 * to recover the date. While fmtDate produced "10-11-2026" that worked. PR #19
 * changed fmtDate to "Oct 11, 2026" — the app-wide format the owner asked for
 * — and the regex stopped matching, with two consequences:
 *
 *   1. min_term_end is never computed, so the "Minimum-term end date" blocker
 *      fires and the agreement CANNOT BE SENT on any template that prints it.
 *   2. startIso goes null, so applyPrep stops checking that an additional
 *      driver's licence is still valid on the start date — a safety check that
 *      fails open and silently.
 *
 * The fix threads the real date through instead of parsing the display string,
 * so the two can never be coupled again. These tests are written against the
 * behaviour, not the regex, and the last block asserts the coupling is gone.
 *
 * Pure functions, no database, no network.
 *
 * Run: node scripts/contract-min-term.test.mjs   (npm run test:min-term)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".min-term-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
execFileSync("npx", ["esbuild", "src/lib/agreement-dates.ts", "--bundle", "--platform=node",
  "--format=esm", `--outfile=${OUT}/dates.mjs`, "--alias:@=./src"],
  { stdio: ["ignore", "ignore", "inherit"] });
const D = await import(`../${OUT}/dates.mjs`);

// agreements.functions.ts is a server-function module; these stand in for the
// framework and the client so the pure parts can be imported and driven.
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
export const supabaseAdmin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
export const supabase = supabaseAdmin;
export default supabaseAdmin;
`);
execFileSync("npx", ["esbuild", "src/lib/date-format.ts", "--bundle", "--platform=node",
  "--format=esm", `--outfile=${OUT}/fmt0.mjs`, "--alias:@=./src"],
  { stdio: ["ignore", "ignore", "inherit"] });
const F0 = await import(`../${OUT}/fmt0.mjs`);

// ================================================= the arithmetic
console.log("\\nminimum term is start + weeks x 7, counted in calendar days");
const CASES = [
  // start,        weeks, expected end
  ["2026-10-11", 1, "2026-10-18"],
  ["2026-10-11", 4, "2026-11-08"],
  ["2026-10-11", 12, "2027-01-03"],
  ["2026-01-01", 1, "2026-01-08"],
];
for (const [start, weeks, want] of CASES) {
  const got = D.minTermEndIso(start, weeks);
  ok(got === want, `${start} + ${weeks}w -> ${got} (want ${want})`);
}

console.log("\\nmonth boundaries");
for (const [start, weeks, want] of [
  ["2026-01-25", 1, "2026-02-01"],   // into the next month
  ["2026-01-31", 1, "2026-02-07"],   // from a 31st into a short month
  ["2026-02-28", 1, "2026-03-07"],   // out of February, common year
  ["2026-04-30", 2, "2026-05-14"],
  ["2026-08-31", 1, "2026-09-07"],
]) {
  ok(D.minTermEndIso(start, weeks) === want, `${start} + ${weeks}w -> ${D.minTermEndIso(start, weeks)} (want ${want})`);
}

console.log("\\nyear boundaries");
for (const [start, weeks, want] of [
  ["2026-12-28", 1, "2027-01-04"],
  ["2026-12-31", 2, "2027-01-14"],
  ["2027-12-25", 4, "2028-01-22"],
]) {
  ok(D.minTermEndIso(start, weeks) === want, `${start} + ${weeks}w -> ${D.minTermEndIso(start, weeks)} (want ${want})`);
}

console.log("\\nleap years, where a wrong month table shows up");
for (const [start, weeks, want] of [
  ["2028-02-28", 1, "2028-03-06"],   // 2028 IS a leap year: Feb has 29
  ["2028-02-29", 1, "2028-03-07"],   // from the leap day itself
  ["2028-02-22", 1, "2028-02-29"],   // landing exactly on the leap day
  ["2100-02-27", 1, "2100-03-06"],   // 2100 is NOT a leap year
]) {
  ok(D.minTermEndIso(start, weeks) === want, `${start} + ${weeks}w -> ${D.minTermEndIso(start, weeks)} (want ${want})`);
}

console.log("\\nnothing to compute returns nothing, never a guess");
for (const [start, weeks] of [
  [null, 4], ["", 4], ["2026-10-11", 0], ["2026-10-11", -1],
  ["not a date", 4], ["2026-13-45", 4],
  // Days that are in range for SOME month but do not exist in THIS one.
  // Date.UTC rolls these forward silently — 2026-02-30 becomes March 2 — so a
  // date nobody typed would end up in a contract. They must be refused.
  ["2026-02-30", 4], ["2026-02-29", 4], ["2026-04-31", 4], ["2026-06-31", 1], ["2100-02-29", 1],
]) {
  const got = D.minTermEndIso(start, weeks);
  ok(got === null, `${JSON.stringify(start)} + ${weeks}w -> null (got ${JSON.stringify(got)})`);
}

// ================================================= the timezone rule
console.log("\\na date-only value does not move with the reader");
const probe = `
import * as D from "../${OUT}/dates.mjs";
const cases = ${JSON.stringify([["2026-10-11", 4, "2026-11-08"], ["2026-12-31", 1, "2027-01-07"], ["2028-02-29", 1, "2028-03-07"]])};
const bad = cases.filter(([s, w, want]) => D.minTermEndIso(s, w) !== want)
  .map(([s, w, want]) => \`\${s}+\${w}w: \${D.minTermEndIso(s, w)} != \${want}\`);
console.log(JSON.stringify({ bad }));
`;
writeFileSync(`${OUT}/probe.mjs`, probe);
for (const tz of ["America/New_York", "UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata"]) {
  const out = execFileSync("node", [`${OUT}/probe.mjs`], { encoding: "utf8", env: { ...process.env, TZ: tz } });
  const { bad } = JSON.parse(out.trim().split("\\n").pop());
  ok(bad.length === 0, `in ${tz}, the end date is the same calendar day${bad.length ? ` — ${bad.join("; ")}` : ""}`);
}

// ============================== the function that actually broke
//
// minTermEndIso being right is not enough: the bug was in the caller, which
// recovered the date from the rendered string. So drive templateFieldBlockers
// itself, with a template that prints {{min_term_end}} and a 4-week term.
console.log("\\nthe merge data gets a minimum-term end date, from the real start date");
execFileSync("npx", ["esbuild", "src/lib/agreements.functions.ts", "--bundle", "--platform=node",
  "--format=esm", `--outfile=${OUT}/ag.mjs`, "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
  `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`],
  { stdio: ["ignore", "ignore", "inherit"] });
const AGMOD = await import(`../${OUT}/ag.mjs`);

/** A template body that prints the field, with a 4-week minimum term. */
const BODY = "Minimum term ends {{min_term_end}}.\n%%BUILDER_TERMS " +
  JSON.stringify({ min_term_weeks: "4 weeks" }) + "%%";

function run(startIso, body = BODY) {
  // start_date carries the RENDERED value, as buildMergeData leaves it — the
  // point being that nothing reads it any more.
  const data = { start_date: startIso ? F0.fmtDate(startIso) : "", min_term_end: "" };
  const blockers = [];
  AGMOD.templateFieldBlockers(body, data, blockers, null, null, startIso);
  return { data, blockers };
}

let r = run("2026-10-11");
ok(r.data.min_term_end === "Nov 8, 2026",
  `a 4-week term from Oct 11 ends Nov 8, 2026 (got ${JSON.stringify(r.data.min_term_end)})`);
ok(!r.blockers.some((b) => b.field === "min_term_end"),
  "and no Minimum-term end date blocker fires, so the agreement can be sent");
ok(r.data.start_date === "Oct 11, 2026",
  "while start_date still carries the app-wide display format, unread by the calculation");

r = run("2026-12-31");
ok(r.data.min_term_end === "Jan 28, 2027", `across a year boundary (${r.data.min_term_end})`);
r = run("2028-02-22");
ok(r.data.min_term_end === "Mar 21, 2028", `across a leap February (${r.data.min_term_end})`);

console.log("\\nand with nothing to compute from, it blocks rather than guessing");
r = run(null);
ok(!r.data.min_term_end, "no start date means no minimum-term end date");
ok(r.blockers.some((b) => b.field === "min_term_end"),
  "  and the Minimum-term end date blocker fires, which is what stops a blank contract");

const NO_TERM = "Minimum term ends {{min_term_end}}.\n%%BUILDER_TERMS " +
  JSON.stringify({ min_term_weeks: "" }) + "%%";
r = run("2026-10-11", NO_TERM);
ok(!r.data.min_term_end, "a template with no minimum term computes none");
ok(r.blockers.some((b) => b.field === "min_term_end"), "  and blocks, rather than printing a guess");

const NO_FIELD = "This template never mentions a minimum term.\n%%BUILDER_TERMS " +
  JSON.stringify({ min_term_weeks: "4 weeks" }) + "%%";
r = run("2026-10-11", NO_FIELD);
ok(!r.data.min_term_end, "a template that does not print the field gets no value");
ok(!r.blockers.some((b) => b.field === "min_term_end"), "  and is not blocked for a field it never uses");

// ============ the whole generation step, not just the one function
//
// The two things the regression broke live at opposite ends of
// prepareAgreement: buildMergeData has to HAND OUT the real start date, and
// applyPrep has to RECEIVE it. Driving templateFieldBlockers alone proves
// neither, so this block runs the real generation step through issueAgreement
// — which calls prepareAgreement and then throws, listing the blockers, before
// it renders or sends anything.
console.log("\\nthe real generation step threads the start date end to end");

/**
 * Just enough PostgREST to answer buildMergeData's reads: .select().eq()...
 * then either .maybeSingle() or an awaited array. No network, no database.
 */
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
const START = "2026-10-11";

/** A driver with nothing missing, so the only blockers are the ones under test. */
const COMPLETE_APP = {
  id: APP_ID,
  full_name: "Dana Reyes",
  email: "dana@example.com",
  phone: "813-555-0142",
  address: "1200 N Ashley Dr",
  city: "Tampa",
  state: "FL",
  zip: "33602",
  license_number: "R123-456-78-901-0",
  license_state: "FL",
  license_expiration: "2030-04-30",
  vehicle_id: VEH_ID,
  weekly_rent: 329,
  deposit_amount: 0,
  market_id: null,
  dob: "1991-07-02",
  card_brand: "visa",
  card_last4: "4242",
  insurance_carrier: "Progressive",
  insurance_policy_number: "PP-99812",
  contract_start_date: START,
  contract_end_date: "2027-04-11",
};
const VEHICLE = {
  id: VEH_ID, year: 2023, make: "Toyota", model: "Camry", trim: "LE", color: "Silver",
  vin: "1HGCM82633A004352", unit_number: "14", weekly_rate: 329, deposit: 0,
  license_plate: "ABC1234", plate_state: "FL",
};
/** Prints the minimum-term field, with a 4-week term, and nothing else. */
const TEMPLATE = {
  id: "33333333-3333-4333-8333-333333333333", name: "Rental Agreement", version: 1, is_active: true,
  body: "Minimum term ends {{min_term_end}}.\n%%BUILDER_TERMS " + JSON.stringify({ min_term_weeks: "4 weeks" }) + "%%",
};

const prepWith = (licenseExpiration) => ({
  drivers: { mode: "listed", list: [{ name: "Marco Reyes", licenseNumber: "R999-111-22-333-0", licenseState: "FL", licenseExpiration, verified: true }] },
  reservation: { mode: "not_required", amount: null },
  deposit: { mode: "none", amount: null, reason: "" },
});

/** Runs the real generation step and returns the refusal message it raises. */
async function refusal(app, prep) {
  const admin = fakeAdmin({ applications: [app], vehicles: [VEHICLE], rentals: [], markets: [], app_settings: [], agreement_templates: [TEMPLATE] });
  try {
    await AGMOD.issueAgreement(admin, app.id, prep ? { prep } : {});
    return "<no refusal: the agreement was not blocked>";
  } catch (e) {
    return String(e?.message ?? e);
  }
}

// AN ADDITIONAL DRIVER'S LICENCE MUST BE VALID ON THE START DATE. This is the
// check that failed open: applyPrep skips it when startIso is null, so an
// expired licence reached a signed agreement with no warning at all.
let msg = await refusal(COMPLETE_APP, prepWith("2026-05-01"));
ok(/license valid on the start date/i.test(msg),
  `an additional driver whose licence expired before ${START} blocks the send (${msg})`);

// The same check must not fire for a licence that is still valid — otherwise
// the assertion above would pass on a blocker that is simply always on. The
// phone is blanked so this still refuses at the blocker list rather than
// going on to render and send a document.
msg = await refusal({ ...COMPLETE_APP, phone: "" }, prepWith("2031-05-01"));
ok(/driver phone/i.test(msg), `  a blank phone still blocks (${msg})`);
ok(!/license valid on the start date/i.test(msg),
  "  and a licence valid past the start date does not");

// AND THE MINIMUM-TERM END DATE IS COMPUTED on this path too: if the start
// date did not reach templateFieldBlockers, the template's {{min_term_end}}
// would be blank and its blocker would appear in this same list.
ok(!/minimum-term end date/i.test(msg),
  "  with the minimum-term end date computed, so it is not among the blockers");

// With no start date agreed at all, both of those are blocked rather than guessed.
msg = await refusal({ ...COMPLETE_APP, contract_start_date: null }, prepWith("2026-05-01"));
ok(/contract start date/i.test(msg) && /minimum-term end date/i.test(msg),
  `  and with no start date, the contract start date and minimum-term end date both block (${msg})`);

// ================================================= the coupling is gone
console.log("\\nno calculation reads a formatted date any more");
const AG = readFileSync("src/lib/agreements.functions.ts", "utf8");
const code = AG.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok(!/\(\\d\{2\}\)-\(\\d\{2\}\)-\(\\d\{4\}\)/.test(code),
  "the MM-DD-YYYY regex is gone from agreements.functions.ts");
ok(!/data\.start_date \?\? ""\)\.match\(/.test(code) && !/start_date[^\n]*\.match\(/.test(code),
  "and nothing matches against start_date at all");
ok(/minTermEndIso/.test(code), "the minimum term is computed by minTermEndIso");
ok(/built\.startIso|startIso:/.test(code), "and the real start date is threaded through as startIso");

const DATES = readFileSync("src/lib/agreement-dates.ts", "utf8");
const dcode = DATES.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const forbidden of ["fmtDate", "toLocaleDateString", "match(", "supabase"]) {
  ok(!dcode.includes(forbidden), `agreement-dates.ts does not touch ${forbidden}`);
}

// ================================================= display is untouched
// Contract fields print the same "Oct 11, 2026" form as the app-wide helper
// (the Owner's decision, and what Release A printed), but through the
// contract formatter in agreement-dates.ts, so a dashboard format change can
// never move contract wording or a fingerprint. contract-date-format.test.mjs
// proves the output matches Release A's fmtDate for date-only inputs.
console.log("\\nwhat the contract PRINTS is unchanged, through the contract formatter");
execFileSync("npx", ["esbuild", "src/lib/date-format.ts", "--bundle", "--platform=node",
  "--format=esm", `--outfile=${OUT}/fmt.mjs`, "--alias:@=./src"],
  { stdio: ["ignore", "ignore", "inherit"] });
const F = await import(`../${OUT}/fmt.mjs`);
ok(F.fmtDate("2026-10-11") === "Oct 11, 2026",
  `the app-wide month-day-year format is intact (${F.fmtDate("2026-10-11")})`);
ok(F.fmtDateTime("2026-10-11T12:30:00Z").startsWith("Oct 11, 2026,"),
  "and so is the date-and-time one");
ok(/start_date: startDate \? fmtContractDate\(startDate\) : ""/.test(AG),
  "the contract prints its start date with the CONTRACT formatter");
ok(/return_date: endDate \? fmtContractDate\(endDate\) : ""/.test(AG), "  and its return date");
ok(/driver_dob: app\.dob \? fmtContractDate\(app\.dob\) : ""/.test(AG), "  and the driver's date of birth");
ok(/min_term_end = fmtContractDate\(/.test(AG), "  and the minimum-term end date it now computes correctly");
ok(!/\bfmtDate\(/.test(AG), "  and no contract field is left on the UI formatter");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\\n${fail} blocker(s)` : "\\nall contract minimum-term checks pass");
process.exit(fail ? 1 : 0);
