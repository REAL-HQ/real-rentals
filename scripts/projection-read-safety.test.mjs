/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   A FAILED READ OF public.application_read_projection IS NEVER RENDERED AS
 *   AN EMPTY RESULT. "YOU HAVE NO PAYMENTS" IS A CLAIM ABOUT SOMEBODY'S
 *   ACCOUNT, AND IT IS ONLY MADE WHEN THE DATABASE ACTUALLY SAID SO.
 *
 * Thirteen call sites read that view, and every one of them destructured only
 * `data`:
 *
 *     const { data: apps } = await supabase.from("application_read_projection")...
 *     const appIds = (apps ?? []).map((a) => a.id);
 *
 * The view comes from migration 0030. Where 0030 is not installed, the read
 * fails with 42P01, `apps` is undefined, `appIds` is [], the payments query is
 * skipped and the renter sees an empty Payments tab presented as the truth.
 * Their agreements vanish the same way — including one sent to them to sign —
 * and the pre-rental panel, which decides between "You're Approved" and a
 * neutral headline from this same read, loses the only thing that tells a
 * rejected applicant from an approved one.
 *
 * None of it announces itself, because a failed read and a genuinely empty
 * account produce the identical screen. So the three answers are held apart
 * here:
 *
 *   MISSING VIEW (42P01 / PGRST205) -> refuse, naming the cause
 *   PERMISSION DENIED (42501)       -> refuse, naming the cause
 *   GENUINELY EMPTY                 -> succeed, and return the empty answer
 *
 * The third case matters as much as the other two: a guard that refuses an
 * empty account would break every driver who has not been charged yet, and
 * "fails closed" is not a licence to fail always.
 *
 * NO FALLBACK IS TESTED FOR, BECAUSE NONE EXISTS. Reading public.applications
 * when the view is missing was checked against 0030 and rejected: 0030 revokes
 * SELECT from `authenticated` and re-grants an allowlist that excludes `city`,
 * `address`, `state`, `zip` and `sms_consent`, all five of which the profile
 * read needs. A column grant is not row-scoped, so the fallback would be
 * refused even for a driver reading their own record — nine columns working,
 * five denied, and the 0030 boundary routed around. The last assertions below
 * pin that absence, so nobody adds one later by reflex.
 *
 * Real server modules, fake Supabase, synthetic drivers. No network, no real
 * record, no payment operation.
 *
 * Run: node scripts/projection-read-safety.test.mjs   (npm run test:projection-reads)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".projection-build";
const PROJ = "application_read_projection";
const U1 = "44444444-0000-4000-8000-000000000001"; // auth user
const A1 = "22222222-0000-4000-8000-000000000001"; // their application row
const U2 = "44444444-0000-4000-8000-000000000002"; // a driver with nothing yet

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });
writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
export const useServerFn = (f) => f;
`);
writeFileSync(`${OUT}/stub/react-start-server.js`, `
export const getRequest = () => ({ headers: new Map() });
export const getRequestHeader = () => null;
`);
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
  execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${OUT}/${out}`, ...alias], { stdio: ["ignore", "ignore", "inherit"] });

build("src/lib/portal.functions.ts", "portal.mjs");
build("src/lib/charges.functions.ts", "charges.mjs");
build("src/lib/agreements.functions.ts", "agreements.mjs");
build("src/lib/application-projection.ts", "projection.mjs");

const portal = await import(`../${OUT}/portal.mjs`);
const charges = await import(`../${OUT}/charges.mjs`);
const agreements = await import(`../${OUT}/agreements.mjs`);
const P = await import(`../${OUT}/projection.mjs`);
const { supabaseAdmin } = await import(`../${OUT}/stub/supabase.js`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const call = (fn, userId = U1, data = {}) =>
  fn({ data: fn._validate ? fn._validate(data) : data, context: { supabase: supabaseAdmin, userId } });

/** A driver with a real application, a real rental and real money owed. */
function seed() {
  S.tables = {
    user_roles: [{ user_id: U1, role: "driver" }, { user_id: U2, role: "driver" }],
    [PROJ]: [
      { id: A1, user_id: U1, status: "approved", full_name: "Dana Rivers", created_at: "2026-09-01T10:00:00Z",
        city: "Tampa", address: "1 Bay St", state: "FL", zip: "33602", sms_consent: true,
        email: "dana@example.com", phone: "8135550111" },
    ],
    applications: [{ id: A1, user_id: U1, status: "approved", full_name: "Dana Rivers" }],
    payments: [
      { id: "p-1", driver_id: A1, type: "rent", status: "due", amount: 350, paid_date: null },
      { id: "p-2", driver_id: A1, type: "rent", status: "paid", amount: 350, paid_date: "2026-09-28" },
    ],
    toll_charges: [
      { id: "t-1", application_id: A1, status: "rebilled", amount: 12.5, admin_fee: 5, occurred_at: "2026-09-20T10:00:00Z" },
    ],
    agreements: [
      { id: "ag-1", application_id: A1, title: "Rental Agreement", status: "sent", body: "x",
        signed_at: null, sent_at: "2026-09-02T10:00:00Z", document_id: null, created_at: "2026-09-02T10:00:00Z" },
    ],
    rentals: [], documents: [], maintenance_records: [], notifications: [], shops: [],
    vehicles: [], audit_log: [],
  };
  S.log = []; S.failSelect = null;
}

/** The two refusals PostgREST actually returns for this view. */
const MISSING = { code: "42P01", message: 'relation "public.application_read_projection" does not exist' };
const DENIED = { code: "42501", message: "permission denied for view application_read_projection" };

const refuse = (err) => { S.failSelect = { [PROJ]: err }; };

/** What a caller did: "answered" with a value, or "refused" with a message. */
async function outcome(fn, userId = U1, data = {}) {
  try { return { kind: "answered", value: await call(fn, userId, data) }; }
  catch (e) { return { kind: "refused", err: e, message: String(e?.message ?? "") }; }
}

// ====================================================== the classifier itself
console.log("\nthe three answers are told apart");
seed();
ok(P.classifyProjectionError(null) === null, "a successful read is not a failure");
ok(P.classifyProjectionError(undefined) === null, "an absent error is not a failure");
ok(P.classifyProjectionError(MISSING) === "missing_view", "42P01 is a missing view");
ok(P.classifyProjectionError({ code: "PGRST205", message: "Could not find the table" }) === "missing_view",
  "PGRST205 is a missing view");
ok(P.classifyProjectionError({ code: null, message: 'relation "x" does not exist' }) === "missing_view",
  "a missing view is caught by message when the code is absent");
ok(P.classifyProjectionError(DENIED) === "denied", "42501 is permission denied");
ok(P.classifyProjectionError({ code: "08006", message: "connection failure" }) === "failed",
  "anything else is a plain failure, still a failure");
ok(P.classifyProjectionError({ code: "PGRST116", message: "0 rows" }) !== null,
  "an error object is never read as an empty result");

console.log("\nthe refusal names the environment fault, not the relation");
{
  let caught = null;
  try { P.assertProjectionOk(MISSING, "your payments"); } catch (e) { caught = e; }
  ok(P.isApplicationReadUnavailable(caught), "a missing view throws ApplicationReadUnavailable");
  ok(caught.kind === "missing_view", "the kind survives the throw");
  ok(/your payments/.test(caught.message), "the message says which part of the portal is affected");
  ok(/0030/.test(caught.message), "an operator reading the log is told the migration is missing");
  ok(!/application_read_projection/.test(caught.message.replace(/\(.*\)$/, "")),
    "the renter-facing sentence does not leak the relation name");
  ok(P.assertProjectionOk(null, "your payments") === undefined, "a clean read passes straight through");
}

// ============================================== dashboard: payments + status
console.log("\nthe dashboard refuses to claim an empty account");
for (const [name, err] of [["missing view", MISSING], ["permission denied", DENIED]]) {
  seed(); refuse(err);
  const r = await outcome(portal.getDriverDashboard);
  ok(r.kind === "answered", `${name}: the dashboard still renders (Support stays reachable)`);
  const d = r.value ?? {};
  ok(d.unavailable?.payments, `${name}: payments are marked unavailable`);
  ok((d.payments ?? []).length === 0 && d.unavailable?.payments,
    `${name}: an empty payments list is never sent without the reason beside it`);
  ok(d.unavailable?.applicationStatus, `${name}: the application status is marked unavailable`);
  ok(d.applicationStatus === null, `${name}: the status is null, and the marker says why`);
}

console.log("\na genuinely empty account is answered, not refused");
{
  seed();
  const r = await outcome(portal.getDriverDashboard, U2);
  ok(r.kind === "answered", "a driver with no application is answered");
  const d = r.value ?? {};
  ok(!d.unavailable?.payments && !d.unavailable?.applicationStatus,
    "nothing is marked unavailable when the read succeeded");
  ok(Array.isArray(d.payments) && d.payments.length === 0, "the empty payments list is returned as fact");
  ok(d.applicationStatus === null, "no application on file reads as null");

  const mine = await outcome(portal.getDriverDashboard, U1);
  ok(mine.kind === "answered" && mine.value.payments.length === 2,
    "and the seeded driver's two payments still come back");
  ok(mine.value.applicationStatus === "approved", "their approved status still comes back");
}

// ===================================================== documents + profile
console.log("\nthe other portal reads refuse rather than return a short answer");
const PORTAL_READS = [
  ["getDriverDocuments", portal.getDriverDocuments, "your documents"],
  ["getDriverProfile", portal.getDriverProfile, "your profile"],
  ["getMyCharges", charges.getMyCharges, "your charges"],
  ["getMyAgreements", agreements.getMyAgreements, "your agreements"],
];
for (const [name, fn, where] of PORTAL_READS) {
  for (const [label, err] of [["missing view", MISSING], ["permission denied", DENIED]]) {
    seed(); refuse(err);
    const r = await outcome(fn);
    ok(r.kind === "refused" && P.isApplicationReadUnavailable(r.err),
      `${name} (${label}): refuses instead of answering`);
    ok(r.kind === "refused" && r.message.includes(where),
      `${name} (${label}): says it is "${where}" that is unavailable`);
  }
}

console.log("\nand the same reads answer normally when the view works");
{
  seed();
  const docs = await outcome(portal.getDriverDocuments);
  ok(docs.kind === "answered" && Array.isArray(docs.value), "documents answer with a list");
  const prof = await outcome(portal.getDriverProfile);
  ok(prof.kind === "answered" && prof.value?.status === "approved", "the profile answers with the real status");
  ok(prof.kind === "answered" && prof.value?.city === "Tampa",
    "the profile reads city through the view — the column 0030 revokes on the base table");
  const ch = await outcome(charges.getMyCharges);
  ok(ch.kind === "answered" && ch.value.length === 1, "the one rebilled toll comes back");
  const ag = await outcome(agreements.getMyAgreements);
  ok(ag.kind === "answered" && ag.value.length === 1, "the one unsigned agreement comes back");

  // The empty case, for the driver who has nothing: still an answer.
  const chEmpty = await outcome(charges.getMyCharges, U2);
  ok(chEmpty.kind === "answered" && chEmpty.value.length === 0, "no tolls is an empty list, not a refusal");
  const agEmpty = await outcome(agreements.getMyAgreements, U2);
  ok(agEmpty.kind === "answered" && agEmpty.value.length === 0, "no agreements is an empty list, not a refusal");
}

// =============================== the signing write keeps failing CLOSED
console.log("\nan unreadable projection never opens the signing path");
{
  seed(); refuse(MISSING);
  const r = await outcome(agreements.signMyAgreement, U1, {
    agreementId: "ag-1", signerName: "Dana Rivers", agree: true,
  });
  ok(r.kind === "refused", "signing is refused when ownership cannot be verified");
  ok(!(S.log ?? []).some((e) => e.op !== "insert" || e.table === "agreements"),
    "no agreement row was written");
  ok(!(S.rpcs ?? []).some((c) => /esign_claim|complete/i.test(c.name)),
    "the eSign claim transaction was never reached");
}

// ================================= no fallback was introduced to the base table
console.log("\nevery projection read in the tree is checked, and none falls back");
{
  const FILES = [
    "src/lib/portal.functions.ts", "src/lib/charges.functions.ts",
    "src/lib/agreements.functions.ts", "src/lib/documents.functions.ts",
    "src/lib/partner.functions.ts", "src/components/admin/PaymentsPanel.tsx",
  ];
  let sites = 0;
  for (const f of FILES) {
    const src = readFileSync(f, "utf8");
    const found = [...src.matchAll(/\.from\("application_read_projection"/g)];
    ok(found.length > 0, `${f}: reads the projection (${found.length} site(s))`);
    sites += found.length;
    for (const m of found) {
      // Each read must have its error checked close by. The original bug was
      // not a missing branch somewhere — it was no mention of `error` at all
      // in the whole query, so proximity is the property worth asserting.
      const after = src.slice(m.index, m.index + 1400);
      const line = src.slice(0, m.index).split("\n").length;
      ok(/assertProjectionOk\(|classifyProjectionError\(/.test(after),
        `${f}:${line} — the read's error is classified`);
    }
  }
  ok(sites === 13, `all thirteen call sites are accounted for (${sites})`);

  // The fallback itself. A projection read exists because the base table is
  // NOT reachable from a driver's session, so any `.from("applications")` in
  // these modules must be a service-role read — supabaseAdmin, or the `admin`
  // client a helper is handed — and never context.supabase.
  for (const f of FILES) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/([A-Za-z_$][\w$.]*)\s*\n?\s*\.from\("applications"\)/g)) {
      ok(/(^|\.)(supabaseAdmin|admin)$/.test(m[1]),
        `${f}: public.applications is read as the service role, not the driver's session (via "${m[1]}")`);
    }
  }

  const projection = readFileSync("src/lib/application-projection.ts", "utf8");
  ok(/no fallback/i.test(projection) && /city/.test(projection) && /sms_consent/.test(projection),
    "the module records WHY the applications fallback is unsafe, naming the revoked columns");
  // Outside its own comments, the helper touches no client at all: it
  // classifies an error somebody else already got back.
  const code = projection.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(!/\.from\(|supabase/.test(code), "the helper reads nothing itself — it only classifies");
}

console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall projection read-safety checks pass");
process.exit(fail ? 1 : 0);
