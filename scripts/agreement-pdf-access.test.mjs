/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   A SIGNED AGREEMENT PDF IS OWNER-OR-MANAGER. A COORDINATOR GETS THE STATUS.
 *   A DRIVER KEEPS THEIR OWN CONTRACT, AND REACHES NOBODY ELSE'S.
 *   AN UNAUTHORIZED ANSWER CARRIES NO BYTES, NO BASE64 AND NO STORAGE PATH.
 *   BOOKINGS OFFERS THE PDF ON EXACTLY THE SERVER'S TERMS, AND ADDS NO GATE.
 *
 * The gap: getAgreementPdf had no role check of its own and read through RLS,
 * where "Staff read agreements" is private.is_staff() — which includes
 * Coordinator. So a Coordinator could download any signed contract, with the
 * renter's address, licence details, date of birth and card digits in it.
 *
 * The fix is NOT on this branch. Codex's reviewed hotfix
 * (origin/hotfix/security-identity) adds it:
 *
 *   if (await getActor(context.userId)) await requireManager(context.userId);
 *
 * — "if you are staff at all, you must be a Manager", which leaves the
 * non-staff path untouched so a driver still reads their own through RLS.
 *
 * This file therefore does two separate jobs:
 *
 *   PART 1 verifies that hotfix, by building ITS version of the module and
 *   running the matrix against it. It is a dependency check, not a
 *   reimplementation — nothing from the hotfix is committed here. It skips
 *   loudly if the branch is not fetched.
 *
 *   PART 2 verifies what IS on this branch: the Bookings drawer offers the
 *   PDF to a Manager and withholds it from a Coordinator, while keeping the
 *   status metadata they need, and adds no authorization logic of its own.
 *
 * Real modules, fake Supabase, synthetic agreements. No network, no real file.
 *
 * Run: node scripts/agreement-pdf-access.test.mjs   (npm run test:agreement-pdf)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };
const note = (l) => console.log(`  ----  ${l}`);

const OUT = ".agreement-pdf-build";
const HOTFIX = "origin/hotfix/security-identity";
const AG1 = "88888888-0000-4000-8000-000000000001"; // signed + archived, driver U1
const AG2 = "88888888-0000-4000-8000-000000000002"; // signed + archived, driver U2
const AG3 = "88888888-0000-4000-8000-000000000003"; // sent, not signed
const A1 = "22222222-0000-4000-8000-000000000001";
const A2 = "22222222-0000-4000-8000-000000000002";
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
writeFileSync(`${OUT}/stub/email-server.js`, `
export const sendEmail = async () => ({ ok: true });
export const sendTemplateEmail = async () => ({ ok: true });
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

const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });
const SB = await import(`../${OUT}/stub/supabase.js`);

const ROLES = [
  { user_id: "own-1", role: "admin" },
  { user_id: "mgr-1", role: "team" },
  { user_id: "crd-1", role: "coordinator" },
  { user_id: U1, role: "driver" },
  { user_id: U2, role: "driver" },
];

function seed() {
  S.tables = {
    user_roles: ROLES,
    applications: [
      { id: A1, user_id: U1, full_name: "Dana Rivers", email: "dana@example.com",
        license_number: "R123456789012", dob: "1990-02-03", address: "1 Palm St" },
      { id: A2, user_id: U2, full_name: "Omar Vance", email: "omar@example.com",
        license_number: "V987654321098", dob: "1988-07-11", address: "2 Bay Ave" },
    ],
    agreements: [
      { id: AG1, application_id: A1, rental_id: null, status: "signed", document_id: "doc-1",
        archive_status: "archived", title: "Rental Agreement", signed_at: "2026-09-01T07:00:00Z" },
      { id: AG2, application_id: A2, rental_id: null, status: "signed", document_id: "doc-2",
        archive_status: "archived", title: "Rental Agreement", signed_at: "2026-09-05T07:00:00Z" },
      { id: AG3, application_id: A1, rental_id: null, status: "sent", document_id: null,
        archive_status: "pending", title: "Rental Agreement", signed_at: null },
    ],
    documents: [
      { id: "doc-1", storage_bucket: "agreements", storage_path: "a1/signed.pdf" },
      { id: "doc-2", storage_bucket: "agreements", storage_path: "a2/signed.pdf" },
    ],
  };
  // The bytes of each signed contract, so a leak is something a test can see.
  S.files = {
    "agreements/a1/signed.pdf": [0x25, 0x50, 0x44, 0x46, 0xd1],
    "agreements/a2/signed.pdf": [0x25, 0x50, 0x44, 0x46, 0xd2],
  };
  S.log = []; S.audit = []; S.rpcs = []; S.defaults = {};
}

/**
 * A client that enforces the one RLS policy this endpoint leans on for the
 * non-staff path: "Drivers view their own agreements" — the agreement's
 * application must belong to the caller. Staff read every row, as
 * private.is_staff() allows.
 */
function clientFor(userId) {
  const staff = ROLES.some((r) => r.user_id === userId && ["admin", "team", "coordinator"].includes(r.role));
  if (staff) return SB.supabaseAdmin;
  const mine = new Set(
    (S.tables.applications ?? []).filter((a) => a.user_id === userId).map((a) => a.id),
  );
  return {
    from: (table) => {
      const q = SB.supabaseAdmin.from(table);
      if (table !== "agreements") return q;
      const visible = (S.tables.agreements ?? []).filter((r) => mine.has(r.application_id));
      const ids = visible.map((r) => r.id);
      // Mirror the policy by narrowing to the rows the policy would return.
      const sel = q.select.bind(q);
      return {
        ...q,
        select: (cols, opts) => {
          const built = sel(cols, opts);
          return ids.length ? built.in("id", ids) : built.eq("id", "00000000-0000-4000-8000-000000000000");
        },
      };
    },
  };
}

const call = (fn, data, userId) =>
  fn({
    data: fn._validate ? fn._validate(data) : data,
    context: { userId, supabase: clientFor(userId), claims: { email: `${userId}@example.com` } },
  });
const attempt = async (fn, data, userId) => {
  try { return { ok: true, value: await call(fn, data, userId) }; }
  catch (e) { return { ok: false, message: String(e.message) }; }
};

/** Nothing refused may carry the contract out with it. */
function carriesNothing(res, label) {
  const text = JSON.stringify(res ?? {});
  ok(!/base64/i.test(text), `${label}: no base64 field`);
  ok(!text.includes("JVBERi") && !/%PDF/.test(text), `${label}: no PDF bytes`);
  ok(!text.includes("signed.pdf") && !text.includes("storage_path"), `${label}: no storage path`);
  ok(!text.includes("R123456789012") && !text.includes("V987654321098"), `${label}: no licence number`);
}

// ================================================================= PART 1
console.log("\\n=============== PART 1 — integrated agreement handler, verified against candidate source");
let hotfixSrc = null;
try {
  hotfixSrc = readFileSync("src/lib/agreements.functions.ts", "utf8");
} catch {
  hotfixSrc = null;
}

if (!hotfixSrc) {
  note(`SKIPPED — ${HOTFIX} is not fetched. Run: git fetch origin hotfix/security-identity`);
  note("The Bookings UI assertions in PART 2 still run, and they are what this branch owns.");
} else {
  note(`built from the integrated working candidate`);
  mkdirSync(`${OUT}/hotfix/src/lib`, { recursive: true });
  // Only the one module comes from the hotfix; every import it has resolves
  // against this branch's tree, so the test exercises the gate, not a fork.
  writeFileSync(`${OUT}/hotfix/agreements.functions.ts`, hotfixSrc);
  build(`${OUT}/hotfix/agreements.functions.ts`, "agreements-hotfix.mjs");
  const H = await import(`../${OUT}/agreements-hotfix.mjs`);

  ok(/if \(await getActor\(context\.userId\)\) await requireManager\(context\.userId\);/.test(hotfixSrc),
    "the hotfix gates getAgreementPdf on 'staff must be a Manager'");

  console.log("\\nOwner and Manager may download a signed PDF");
  for (const [who, label] of [["own-1", "an Owner"], ["mgr-1", "a Manager"]]) {
    seed();
    const r = await attempt(H.getAgreementPdf, { agreementId: AG1 }, who);
    ok(r.ok, `${label} gets the PDF${r.ok ? "" : ` — ${r.message}`}`);
    ok(typeof r.value?.base64 === "string" && r.value.base64.length > 0, `  with bytes in it`);
    ok(r.value?.contentType === "application/pdf", "  as a PDF");
  }

  console.log("\\na Coordinator is refused, and gets nothing with it");
  seed();
  const crd = await attempt(H.getAgreementPdf, { agreementId: AG1 }, "crd-1");
  ok(!crd.ok, `a Coordinator is refused (${crd.ok ? "ALLOWED" : crd.message})`);
  ok(/Forbidden/.test(crd.message ?? ""), "  with Forbidden, from the role check and not from storage");
  carriesNothing(crd, "  the refusal");
  ok(!S.log.length, "  and nothing was written");

  console.log("\\na driver keeps their own contract");
  seed();
  const own = await attempt(H.getAgreementPdf, { agreementId: AG1 }, U1);
  ok(own.ok, `the renter still downloads their own agreement${own.ok ? "" : ` — ${own.message}`}`);
  ok(typeof own.value?.base64 === "string" && own.value.base64.length > 0, "  with bytes");

  console.log("\\nand reaches nobody else's");
  seed();
  const cross = await attempt(H.getAgreementPdf, { agreementId: AG2 }, U1);
  ok(!cross.ok, `another driver's agreement is refused (${cross.ok ? "ALLOWED" : cross.message})`);
  carriesNothing(cross, "  the refusal");
  seed();
  const cross2 = await attempt(H.getAgreementPdf, { agreementId: AG1 }, U2);
  ok(!cross2.ok, "and the same the other way round");
  carriesNothing(cross2, "  the refusal");

  console.log("\\nanonymous and unknown callers get nothing");
  seed();
  const anon = await attempt(H.getAgreementPdf, { agreementId: AG1 }, "nobody");
  ok(!anon.ok, `an unknown caller is refused (${anon.ok ? "ALLOWED" : anon.message})`);
  carriesNothing(anon, "  the refusal");

  console.log("\\nan unsigned agreement has no PDF for anybody");
  seed();
  const unsigned = await attempt(H.getAgreementPdf, { agreementId: AG3 }, "own-1");
  ok(!unsigned.ok && /hasn't been signed/.test(unsigned.message),
    `even an Owner is told it is unsigned (${unsigned.message})`);
  carriesNothing(unsigned, "  the refusal");

  console.log("\\nand the hotfix also moved the agreement LIST to Manager");
  ok(/const actor = await requireTierFor\(context\.userId, "manager"\);/.test(hotfixSrc),
    "listAgreements is Manager+ in the hotfix");
  note("Bookings does not call listAgreements — its Agreements tab comes from getBooking.");
}

// ================================================================= PART 2
console.log("\\n=============== PART 2 — what this branch owns: the Bookings drawer");
const DRAWER = readFileSync("src/components/admin/BookingDetails.tsx", "utf8");
const code = DRAWER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok(/d\.canManage \? \(/.test(code) && /data-testid="open-agreement-pdf"/.test(code),
  "the Open Signed PDF button is offered only when the server says canManage");
ok(/data-testid="agreement-pdf-withheld"/.test(code),
  "and a Coordinator is told why, rather than finding a control missing");

const agBlock = code.slice(code.indexOf("function Agreements("), code.indexOf("function Money("));
ok(agBlock.includes("getAgreementPdf"), "the tab still uses the existing getAgreementPdf reader");
for (const forbidden of ["requireManager", "requireStaff", "getActor", "tierAllows", "user_roles", "supabaseAdmin"]) {
  ok(!agBlock.includes(forbidden),
    `and adds no authorization of its own: no ${forbidden}`);
}
ok(!/storage/i.test(agBlock), "it never touches storage directly");

console.log("\\nthe status a Coordinator needs is still rendered");
for (const kept of ["a.status", "a.sentAt", "a.signedAt", "a.voidedAt", "a.archiveStatus"]) {
  ok(agBlock.includes(kept), `${kept} is still shown`);
}

console.log("\\nand the booking read still serves agreement metadata to a Coordinator");
const BOOKFN = readFileSync("src/lib/bookings.functions.ts", "utf8");
ok(/\.from\("agreements"\)/.test(BOOKFN), "getBooking reads the agreements rows itself");
ok(/"id,title,status,sent_at,signed_at,voided_at,archive_status,document_id"/.test(BOOKFN),
  "with metadata columns only — no body, no merge_data, no token, no signer IP");
for (const forbidden of ["body", "merge_data", "token_hash", "signer_ip", "signer_user_agent", "sha256"]) {
  ok(!new RegExp(`agreements[\\s\\S]{0,200}${forbidden}`).test(BOOKFN),
    `and never selects ${forbidden}`);
}

console.log("\\nno competing agreement authorization, and the identity gates are the reviewed ones");
/*
 * This block used to read "documents.functions.ts and applications.functions.ts
 * are untouched on this branch" — the right assertion while the Bookings branch
 * was carrying a UI-only restriction and the reviewed hotfix owned both files.
 *
 * Those gates have since been ported onto main (PR #27), so "untouched" would
 * now fail on the very branch that installed them, and deleting the check would
 * lose what it was protecting. It is replaced by the thing it was really
 * guarding: agreements authorization stays where PR #25 put it, and the six
 * identity endpoints carry the REVIEWED Manager gates rather than any scheme
 * invented alongside them. Behaviour is proved in identity-authorization.test.mjs.
 */
/*
 * Permitted, named integration changes — nothing else may differ:
 *
 *   1. the masked owned-application read; and
 *   2. the approved contract-date change, which moves the five contract
 *      fields off the application-wide display helper and onto
 *      fmtContractDate in agreement-dates.ts. Contract wording changes only
 *      through an Owner-approved template version, and a dashboard date
 *      format must not be able to make one. Driven in
 *      contract-date-format.test.mjs.
 *
 * Both are undone before the comparison, so the check still fails on any
 * OTHER edit to this file.
 */
const baselineAgreement = execFileSync("git", ["show", "origin/main:src/lib/agreements.functions.ts"], { encoding: "utf8" });
const normalised = readFileSync("src/lib/agreements.functions.ts", "utf8")
  .replaceAll('.from("application_read_projection")', '.from("applications")')
  .replaceAll('import { fmtContractDate } from "@/lib/agreement-dates";', 'import { fmtDate } from "@/lib/date-format";')
  .replaceAll("fmtContractDate(", "fmtDate(");
ok(normalised === baselineAgreement,
  "agreement behavior is byte-preserved apart from the masked application read and the approved contract-date change");
const AGFN = readFileSync("src/lib/agreements.functions.ts", "utf8");
ok(/if \(await getActor\(context\.userId\)\) await requireManager\(context\.userId\);/.test(AGFN),
  "getAgreementPdf still carries the gate PR #25 installed");
const DOCFN = readFileSync("src/lib/documents.functions.ts", "utf8");
const APPFN = readFileSync("src/lib/applications.functions.ts", "utf8");
ok((DOCFN.match(/requireManager\(context\.userId\)/g) ?? []).length >= 5,
  "the five document identity endpoints are Manager-and-above");
ok(!/await requireStaff\(context\.userId\)/.test(DOCFN),
  "  and none of them settles for requireStaff");
ok(/const actor = await requireManager\(context\.userId\);[\s\S]{0,400}revokeResumeTokens/.test(APPFN),
  "reissuing an applicant link is Manager-and-above");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\\n${fail} blocker(s)` : "\\nall agreement access checks pass");
process.exit(fail ? 1 : 0);
