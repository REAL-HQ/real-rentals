/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   A DRIVER'S IDENTITY DOCUMENTS, AND THE LINK THAT OPENS THEIR
 *   APPLICATION, ARE MANAGER-AND-ABOVE. A COORDINATOR DOES CASEWORK.
 *   THE DRIVER'S OWN ACCESS TO THEIR OWN PAPERWORK IS UNTOUCHED.
 *
 * These six endpoints were raised to Manager on the reviewed security
 * branch (hotfix/security-identity, commit 47954e1) and never reached main;
 * main carried only the agreement-PDF half of that work, through PR #25.
 * This ports the other half and holds it in place.
 *
 * Six endpoints, five callers each. The REAL modules are bundled and driven
 * — only the framework and the Supabase client are stubbed — because a test
 * that re-implements the check passes while the real one is missing.
 *
 * The two upload endpoints are deliberately NOT a flat requireManager: an
 * applicant uploading against their own application holds no staff grant at
 * all, so the gate reads "if you are staff at all, you must be a Manager".
 * Getting that wrong locks a driver out of their own paperwork, so the
 * driver-own path is asserted here as carefully as the refusals.
 *
 * Run: node scripts/identity-authorization.test.mjs   (npm run test:identity)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".identity-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

writeFileSync(`${OUT}/stub-start.js`, `
export const createServerFn = () => {
  const api = {
    middleware: () => api,
    inputValidator: (v) => ((api._v = v), api),
    handler: (fn) => (args) => fn({ ...args, data: api._v ? api._v(args.data) : args.data }),
  };
  return api;
};
`);
writeFileSync(`${OUT}/stub-start-server.js`, `export const getRequest = () => ({ headers: new Map() });`);
writeFileSync(`${OUT}/stub-auth.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub-sb.js`, `
const S = () => globalThis.__identity;
function table(name) {
  const filters = [];
  let payload = null, kind = "select", cap;
  const rows = () => {
    // The production projection is enforced by database tests; this fixture models its owned row.
    const all = (S().db[name === "application_read_projection" ? "applications" : name] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    return cap == null ? all : all.slice(0, cap);
  };
  const result = () => {
    if (kind !== "select") { S().writes.push({ table: name, kind, payload }); return { data: [payload ?? {}], error: null }; }
    return { data: rows().map((r) => ({ ...r })), error: null };
  };
  const api = {
    select: () => api, eq: (c, v) => (filters.push([c, v]), api), is: () => api,
    // neq/in/not/gte are no-ops here: this stub answers "who may call this",
    // not "what does PostgREST return". They exist so a permitted call runs
    // to completion — an assertion that passes on a MISSING stub method is
    // not an assertion about authorization, which is the mistake this line
    // exists to prevent.
    neq: () => api, gte: () => api, lte: () => api,
    in: () => api, not: () => api, order: () => api, limit: (n) => ((cap = n), api),
    update: (p) => ((kind = "update"), (payload = p), api),
    insert: (p) => ((kind = "insert"), (payload = p), api),
    upsert: (p) => ((kind = "upsert"), (payload = p), api),
    maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (res, rej) => Promise.resolve(result()).then(res, rej),
  };
  return api;
}
const storage = {
  from: () => ({
    createSignedUploadUrl: async (p) => ({ data: { signedUrl: "https://example.test/upload", path: p, token: "t" }, error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/read" }, error: null }),
    remove: async () => ({ data: [], error: null }),
    list: async () => ({ data: [], error: null }),
  }),
};
export const supabaseAdmin = {
  from: table, storage,
  auth: { admin: { getUserById: async (id) => ({ data: { user: { email: S().emails[id] ?? null } } }) } },
};
export const supabase = supabaseAdmin;
export default supabaseAdmin;
`);

const alias = [
  "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
  `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`,
];
for (const [src, out] of [
  ["src/lib/documents.functions.ts", "docs.mjs"],
  ["src/lib/applications.functions.ts", "apps.mjs"],
]) {
  execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${OUT}/${out}`, ...alias], { stdio: ["ignore", "ignore", "inherit"] });
}
const DOCS = await import(`../${OUT}/docs.mjs`);
const APPS = await import(`../${OUT}/apps.mjs`);

const OWNER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const COORD = "33333333-3333-4333-8333-333333333333";
const DRIVER = "44444444-4444-4444-8444-444444444444";
const STRANGER = "55555555-5555-4555-8555-555555555555";
const APP = "66666666-6666-4666-8666-666666666666";
const DOC = "77777777-7777-4777-8777-777777777777";

function reset() {
  globalThis.__identity = {
    writes: [],
    emails: { [OWNER]: "owner@drivereal.com", [MANAGER]: "manager@drivereal.com", [COORD]: "rosa@drivereal.com" },
    db: {
      user_roles: [
        { user_id: OWNER, role: "admin" },
        { user_id: MANAGER, role: "team" },
        { user_id: COORD, role: "coordinator" },
      ],
      // The driver OWNS this application: user_id is their auth id.
      applications: [{ id: APP, user_id: DRIVER, full_name: "Dana Reyes", email: "dana@example.com",
        license_photo_url: null, insurance_doc_url: null, profile_screenshot_url: null,
        trip_screenshots: [], license_expiration: null, status: "reviewing", deleted_at: null }],
      documents: [{ id: DOC, driver_id: APP, category: "license_front", label: "Licence",
        review_status: "uploaded", storage_path: `${APP}/licence.jpg`, is_current: true, visibility: ["driver", "admin"] }],
      audit_log: [],
    },
  };
}
reset();

/** context.supabase is the caller's own client; here it reads the same rows. */
const ctx = (userId) => ({ userId, supabase: globalThis.__identityClient });
globalThis.__identityClient = (await import(`../${OUT}/stub-sb.js`)).supabaseAdmin;

async function refused(run) {
  try { await run(); return null; } catch (e) { return String(e?.message ?? e); }
}
const forbidden = (m) => m !== null && /forbidden/i.test(m);

const CALLS = {
  adminListDriverDocuments: (u) => DOCS.adminListDriverDocuments({ data: { applicationId: APP }, context: ctx(u) }),
  createDocumentUploadUrl: (u) => DOCS.createDocumentUploadUrl({
    data: { applicationId: APP, category: "license_front", fileName: "licence.jpg", mimeType: "image/jpeg" }, context: ctx(u) }),
  confirmDocumentUpload: (u) => DOCS.confirmDocumentUpload({
    data: { applicationId: APP, category: "license_front", path: `${APP}/licence.jpg`, fileName: "licence.jpg" }, context: ctx(u) }),
  updateDocumentMeta: (u) => DOCS.updateDocumentMeta({ data: { documentId: DOC, label: "Renamed" }, context: ctx(u) }),
  setDocumentReview: (u) => DOCS.setDocumentReview({ data: { documentId: DOC, status: "verified" }, context: ctx(u) }),
  reissueApplicantLink: (u) => APPS.reissueApplicantLink({ data: { id: APP }, context: ctx(u) }),
};

// =============================================== the six, caller by caller
console.log("\nTHE SIX IDENTITY ENDPOINTS ARE MANAGER AND ABOVE");
for (const [name, call] of Object.entries(CALLS)) {
  console.log(`\n${name}`);
  for (const [who, id] of [["an Owner", OWNER], ["a Manager", MANAGER]]) {
    reset();
    const msg = await refused(() => call(id));
    ok(!forbidden(msg), `${who} is allowed${forbidden(msg) ? ` — REFUSED: ${msg}` : ""}`);
  }
  reset();
  let msg = await refused(() => call(COORD));
  ok(forbidden(msg), `  a Coordinator is refused (${msg})`);
  ok(globalThis.__identity.writes.length === 0, "    and nothing was written");
  reset();
  msg = await refused(() => call(DRIVER));
  // The two upload endpoints deliberately admit the applicant who owns the
  // row; the other four never do.
  if (name === "createDocumentUploadUrl" || name === "confirmDocumentUpload") {
    ok(!forbidden(msg), `  the driver who OWNS this application is still allowed${forbidden(msg) ? ` — REFUSED: ${msg}` : ""}`);
  } else {
    ok(forbidden(msg), `  a driver is refused (${msg})`);
  }
  reset();
  msg = await refused(() => call(STRANGER));
  ok(msg !== null, `  a signed-in stranger with no grant and no application is refused (${msg})`);
}

// =============================================== the driver's own paperwork
console.log("\nTHE DRIVER'S OWN ACCESS IS NOT COLLATERAL DAMAGE");
reset();
let msg = await refused(() => CALLS.createDocumentUploadUrl(DRIVER));
ok(!forbidden(msg), `a driver can still ask for an upload url for their own application (${msg ?? "allowed"})`);
reset();
msg = await refused(() => DOCS.createDocumentUploadUrl({
  data: { applicationId: APP, category: "license_front", fileName: "x.jpg", mimeType: "image/jpeg" },
  context: ctx(STRANGER) }));
ok(msg !== null, `  but not for somebody else's (${msg})`);
reset();
msg = await refused(() => CALLS.confirmDocumentUpload(DRIVER));
ok(!forbidden(msg), `a driver can still confirm their own upload (${msg ?? "allowed"})`);
reset();
msg = await refused(() => DOCS.confirmDocumentUpload({
  data: { applicationId: APP, category: "license_front", path: "99999999-9999-4999-8999-999999999999/x.jpg" },
  context: ctx(DRIVER) }));
ok(msg !== null, `  and a path outside their own folder is still refused (${msg})`);

// =============================================== the shape of the gate
console.log("\nTHE UPLOAD GATE IS TIERED, NOT FLAT");
const DOCSRC = readFileSync("src/lib/documents.functions.ts", "utf8");
const code = DOCSRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok((code.match(/if \(await getActor\(context\.userId\)\) await requireManager\(context\.userId\);/g) ?? []).length === 2,
  "both upload endpoints use the staff-only-if-staff gate, so an applicant keeps their own path");
ok(!/requireStaff\(context\.userId\)/.test(code),
  "and no identity endpoint in this module settles for requireStaff any more");

console.log("\nTHE REVIEWED AGREEMENT CORRECTION FROM PR #25 IS UNTOUCHED");
const AG = readFileSync("src/lib/agreements.functions.ts", "utf8");
ok(/if \(await getActor\(context\.userId\)\) await requireManager\(context\.userId\);/.test(AG),
  "getAgreementPdf still carries its Manager gate");
const APPSRC = readFileSync("src/lib/applications.functions.ts", "utf8");
ok(/const actor = await requireManager\(context\.userId\);[\s\S]{0,400}revokeResumeTokens/.test(APPSRC),
  "and reissueApplicantLink checks the tier before it mints a link");

console.log("\nWHAT WAS NOT TIGHTENED, DELIBERATELY");
ok(/acknowledgeApplication[\s\S]{0,600}requireStaff\(context\.userId\)/.test(APPSRC),
  "acknowledging an applicant stays Coordinator work — it reads no document and mints no link");
const INSP = readFileSync("src/lib/inspections.functions.ts", "utf8");
ok(/async function canInspect/.test(INSP) && /tierAllows\(await staffTier\(supabase, userId\), "coordinator"\)/.test(INSP),
  "and a Coordinator keeps the handoff inspection permission Bookings R1 gave them");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} blocker(s)` : "\nall identity authorization checks pass");
process.exit(fail ? 1 : 0);
