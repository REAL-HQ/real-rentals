/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   THE DRIVER'S LICENCE EXPIRY PRINTED IN A RENTAL AGREEMENT READS
 *   "Jun 1, 2029" — THE OWNER-APPROVED CONTRACT DATE FORMAT (fmtContractDate,
 *   agreement-dates.ts) EVERY OTHER CONTRACT DATE ALREADY USES — AND IT IS THE
 *   DAY ON THE LICENCE, WHATEVER TIMEZONE THE SERVER RUNS IN.
 *
 * The regression (PR 3, 1bcb437a). buildMergeData formatted start_date,
 * return_date, driver_dob, min_term_end and today as contract dates, but
 * copied applications.license_expiration through untouched, so the built-in
 * template printed "Driver's license: … expires 2029-06-01" next to
 * "Pickup date: Oct 11, 2026".
 *
 * Also proved here:
 *   - a date-only expiry never moves a day (TZ=UTC, Pacific/Honolulu and
 *     Asia/Tokyo give the same text, merge data and fingerprint);
 *   - a missing expiry behaves exactly as before: the "Licence expiry date"
 *     readiness blocker, a blank field, nothing sendable;
 *   - a value that is not a calendar date is never printed, never becomes
 *     "Invalid Date" or a guessed day, and blocks sending;
 *   - a preview rendered by the old code (before deploy) is refused at Send by
 *     the new code, because the fingerprint covers the rendered text — the
 *     same safe behaviour as any wording change; nothing is inserted.
 *
 * Drives the real module through the exported previewAgreement and
 * issueAgreement with a fake PostgREST and a fake clock. No database, no
 * network.
 *
 * Run: node scripts/contract-licence-expiry.test.mjs   (npm run test:licence-expiry)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const OUT = ".contract-licence-build";
const PROBE = process.argv[2] === "--probe";
// The code before this fix, for the "missing stays as before" and the
// deploy-boundary checks: PR 3's tip.
const BASE = "1bcb437a";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

// Nothing in this file may leave the machine.
globalThis.fetch = async (u) => { throw new Error(`contract-licence-expiry: network refused (${u})`); };
delete process.env.RESEND_API_KEY;

const STUB_ALIASES = () => [
  `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
  `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub-roles.js`,
  `--alias:@/lib/email.server=./${OUT}/stub-email.js`,
  `--alias:@/lib/sms.server=./${OUT}/stub-sms.js`,
];

if (!PROBE) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(`${OUT}/base`, { recursive: true });
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
  const esbuild = (src, out, extra = []) => execFileSync("npx", [
    "esbuild", src, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${OUT}/${out}`, "--alias:@=./src", ...extra, ...STUB_ALIASES(),
  ], { stdio: ["ignore", "ignore", "inherit"] });
  esbuild("src/lib/agreements.functions.ts", "ag.mjs");
  // The pre-fix module, unmodified. Its other imports resolve against this
  // tree; only the merge-data step under test is the old one.
  writeFileSync(`${OUT}/base/agreements.functions.ts`, execFileSync("git", ["show", `${BASE}:src/lib/agreements.functions.ts`], { encoding: "utf8" }));
  esbuild(`${OUT}/base/agreements.functions.ts`, "base-ag.mjs");
}
if (!existsSync(`${OUT}/ag.mjs`)) throw new Error("contract-licence-expiry: bundle missing (run without --probe)");
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
  license_number: "R123-456-78-901-0", license_state: "FL", license_expiration: "2029-06-01",
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
// No agreement_templates rows: the built-in template (DEFAULT_AGREEMENT_BODY),
// which prints "expires {{license_expiration}}".
const freshDb = (app = {}) => (globalThis.__fx = fakeDb({
  applications: [{ ...APP, ...app }], vehicles: [{ ...VEHICLE }], rentals: [], markets: [],
  app_settings: [], agreement_templates: [], agreements: [], esign_recipients: [], audit_log: [],
}));
const preview = (mod, app) => (freshDb(app), mod.previewAgreement({ data: { applicationId: APP_ID }, context: { userId: "owner" } }));
const licenceLine = (body) => String(body ?? "").split("\n").find((l) => l.startsWith("Driver's license:")) ?? "";
const NOON_UTC = "2026-10-25T16:00:00Z";
const EXPIRIES = [
  ["2029-06-01", "Jun 1, 2029"],
  ["2029-01-01", "Jan 1, 2029"],   // a UTC-midnight parse in Honolulu would print Dec 31, 2028
  ["2029-12-31", "Dec 31, 2029"],  // and in Tokyo a local-midnight parse would print Dec 30
  ["2028-02-29", "Feb 29, 2028"],
];

// ================================= probe mode: one server timezone, JSON out
if (PROBE) {
  const out = [];
  for (const [iso] of EXPIRIES) {
    const p = await at(NOON_UTC, () => preview(AG, { license_expiration: iso }));
    out.push({ iso, merge: p.merge.license_expiration, line: licenceLine(p.body), fingerprint: p.fingerprint, canSend: p.canSend });
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

const BASEAG = await import(`../${OUT}/base-ag.mjs`);

// ============================== 1. the built-in template prints Jun 1, 2029
console.log("\nthe licence expiry prints as a contract date");
{
  const p = await at(NOON_UTC, () => preview(AG));
  ok(p.merge.license_expiration === "Jun 1, 2029", `license_expiration = ${JSON.stringify(p.merge.license_expiration)} (want "Jun 1, 2029")`);
  ok(licenceLine(p.body) === "Driver's license: R123-456-78-901-0 (FL), expires Jun 1, 2029",
    `the built-in template reads: ${licenceLine(p.body)}`);
  ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(String(p.body)), "no ISO date is printed anywhere in the rendered agreement");
  ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(JSON.stringify(p.merge)), "and no merge field carries one");
  ok(String(p.body).includes("Pickup date: Oct 11, 2026"), "  in the same format as the other contract dates");
  ok(p.canSend === true && p.blockers.length === 0, "the preview is sendable, so this is the text that would go out");
}

// ===================================== 2. no day shift in any server zone
console.log("\na date-only expiry is the day on the licence in every server timezone");
{
  const runs = {};
  for (const tz of ["UTC", "Pacific/Honolulu", "Asia/Tokyo"]) {
    const res = execFileSync("node", [SELF, "--probe"], { encoding: "utf8", env: { ...process.env, TZ: tz } });
    runs[tz] = JSON.parse(res.trim().split("\n").pop());
    for (const [iso, want] of EXPIRIES) {
      const r = runs[tz].find((x) => x.iso === iso);
      ok(r?.merge === want && r.line.endsWith(`expires ${want}`), `TZ=${tz}: ${iso} -> ${r?.merge} (want ${want})`);
    }
  }
  const same = (k) => JSON.stringify(runs.UTC.map((x) => x[k]));
  ok(same("line") === JSON.stringify(runs["Pacific/Honolulu"].map((x) => x.line)) && same("line") === JSON.stringify(runs["Asia/Tokyo"].map((x) => x.line)),
    "the rendered licence line is identical in all three zones");
  ok(same("fingerprint") === JSON.stringify(runs["Pacific/Honolulu"].map((x) => x.fingerprint)) && same("fingerprint") === JSON.stringify(runs["Asia/Tokyo"].map((x) => x.fingerprint)),
    "  and so is the preview fingerprint");
}

// =============================== 3. a missing expiry behaves as it did
console.log("\na missing expiry is a readiness blocker, exactly as before");
for (const missing of [null, ""]) {
  const ours = await at(NOON_UTC, () => preview(AG, { license_expiration: missing }));
  const base = await at(NOON_UTC, () => preview(BASEAG, { license_expiration: missing }));
  const b = ours.blockers.find((x) => x.field === "license_expiration");
  ok(b?.label === "Licence expiry date", `${JSON.stringify(missing)}: the "Licence expiry date" blocker fires`);
  ok(ours.canSend === false && ours.fingerprint == null, "  and nothing is sendable");
  ok(ours.merge.license_expiration === "", "  the merge field stays blank (no invented date)");
  ok(JSON.stringify(ours.blockers) === JSON.stringify(base.blockers), "  the blockers are identical to the code before this fix");
  ok(JSON.stringify(ours.merge) === JSON.stringify(base.merge), "  and so is every merge field");
}

// ===================================== 4. never print a guess
console.log("\na value that is not a calendar date is never printed or guessed");
for (const bad of ["2029-02-30", "not a date", "06/01/2029", "2029-06-01T00:00:00Z"]) {
  const p = await at(NOON_UTC, () => preview(AG, { license_expiration: bad }));
  const text = String(p.body) + JSON.stringify(p.merge);
  ok(p.merge.license_expiration === "", `${JSON.stringify(bad)}: the merge field is blank`);
  ok(!/Invalid Date|NaN/.test(text) && !/(May 31|Jun 1|Mar 2|Mar 1), 2029/.test(text), "  no \"Invalid Date\" and no guessed day");
  ok(p.blockers.some((x) => x.field === "license_expiration") && p.canSend === false, "  and a licence-expiry blocker stops it being sent");
}
{
  // The existing "valid on the start date" check still works on the real value.
  const p = await at(NOON_UTC, () => preview(AG, { license_expiration: "2026-10-01" }));
  ok(p.blockers.some((x) => x.label === "A licence valid on the start date"), "an expiry before the start date still blocks");
}

// ============================ 5. the deploy boundary is fail-safe
console.log("\na preview made by the old code is refused at Send by the new code");
{
  const base = await at(NOON_UTC, () => preview(BASEAG));
  const ours = await at(NOON_UTC, () => preview(AG));
  ok(licenceLine(base.body).endsWith("expires 2029-06-01"), `before: ${licenceLine(base.body)}`);
  const bl = String(base.body).split("\n"), ol = String(ours.body).split("\n");
  const diff = bl.map((l, i) => (l === ol[i] ? null : i)).filter((i) => i != null);
  ok(bl.length === ol.length && diff.length === 1 && bl[diff[0]] === licenceLine(base.body), "the only line that changed is the licence line");
  const md = Object.keys(ours.merge).filter((k) => ours.merge[k] !== base.merge[k]);
  ok(JSON.stringify(md) === JSON.stringify(["license_expiration"]), `the only merge field that changed is license_expiration (${md.join(", ")})`);
  ok(base.fingerprint !== ours.fingerprint, "the fingerprint changes with it");
  const db = freshDb();
  let err = "";
  try { await at(NOON_UTC, () => AG.issueAgreement(db, APP_ID, { fingerprint: base.fingerprint, companyAck: true, createdBy: null })); }
  catch (e) { err = String(e?.message ?? e); }
  ok(/changed since it was previewed/.test(err), `Send with the pre-deploy preview's fingerprint is refused (${err.slice(0, 60)}…)`);
  ok(/^Nothing was sent/.test(err) && /how it prints after a system update/.test(err) && /Regenerate the preview and review it again/.test(err),
    "  and the refusal tells staff nothing was sent, why (including a release changing how it prints), and to regenerate and review");
  ok(!db.inserted.some((x) => x.table === "agreements"), "  and nothing was inserted");
  const db2 = freshDb();
  const r = await at(NOON_UTC, () => AG.issueAgreement(db2, APP_ID, { fingerprint: ours.fingerprint, companyAck: true, createdBy: null }));
  const row = db2.inserted.find((x) => x.table === "agreements")?.row;
  ok(!!r?.url && row?.body === ours.body && row.merge_data?.license_expiration === "Jun 1, 2029", "a fresh preview sends, and the stored text is the reviewed text");
}

// Staff see the refusal until they act on it: the prepare dialog keeps it on
// screen (not only a toast), blocks Send, and offers Regenerate Preview.
{
  const dlg = readFileSync("src/components/admin/PrepareAgreementDialog.tsx", "utf8");
  const send = dlg.slice(dlg.indexOf("async function send()"), dlg.indexOf("function fix("));
  ok(/changed since it was previewed/.test(send) && /setStaleRefusal\(msg\)/.test(send) && /setReviewedKey\(""\)/.test(send),
    "a stale-preview refusal is kept on screen and Send is blocked until a new preview");
  ok(/data-testid="stale-preview-refusal"/.test(dlg) && /role="alert"/.test(dlg) && /\{rendering \? "Regenerating…" : "Regenerate Preview"\}/.test(dlg),
    "the dialog shows the refusal with a Regenerate Preview button (Title Case in the string)");
  ok(/\[key, applicationId, regen\]/.test(dlg) && /setStaleRefusal\(null\)/.test(dlg),
    "Regenerate Preview re-renders, and the notice clears only when a fresh preview arrives");
  const i = dlg.indexOf("stale-preview-refusal");
  ok(!/text-transform|uppercase/.test(dlg.slice(i - 300, i + 600)), "no CSS casing on the notice");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall licence-expiry contract date checks pass");
process.exit(fail ? 1 : 0);
