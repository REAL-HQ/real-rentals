/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   THE ADMIN DASHBOARD READS APPLICATIONS ON THE SERVER, AND THE TIER
 *   DECIDES WHAT COMES BACK. THE IDENTITY COLUMNS READINESS IS DERIVED
 *   FROM NEVER LEAVE THE SERVER — NOT FOR A COORDINATOR, NOT FOR AN
 *   OWNER. A FAILED READ SAYS SO INSTEAD OF RENDERING ZERO.
 *
 * Migration 0030 (coordinator_identity_access) revokes the blanket
 * SELECT ON public.applications from `authenticated` and re-grants an
 * allow-list that does NOT include `deleted_at`. The notification bell and
 * both Overview applicant reads filter on `deleted_at`, so in the browser
 * all three fail outright — for an Owner and a Manager too, because a
 * column grant is not a role policy.
 *
 * The repair is a server read with a field policy, the same shape PR #28
 * gave the Drivers list. This drives the REAL modules: only the framework
 * and the Supabase client are stubbed, so a test that passes while the
 * projection is missing is not possible.
 *
 * Run: node scripts/admin-reads-access.test.mjs   (npm run test:admin-reads)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".adminreads-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

writeFileSync(`${OUT}/stub-start.js`, `
export const createServerFn = () => {
  const api = {
    middleware: () => api,
    inputValidator: (v) => ((api._v = v), api),
    handler: (fn) => (args) => fn({ ...args, data: api._v ? api._v(args?.data) : args?.data }),
  };
  return api;
};
`);
writeFileSync(`${OUT}/stub-start-server.js`, `export const getRequest = () => ({ headers: new Map() });`);
writeFileSync(`${OUT}/stub-auth.js`, `export const requireSupabaseAuth = {};`);

/*
 * The Supabase stub.
 *
 * It implements the filters the real queries use rather than no-opping them:
 * .is("deleted_at", null) and .neq("status","duplicate") are the whole reason
 * a soft-deleted or duplicate applicant must not appear, and a stub that
 * ignored them would report a passing test for a broken query. It also
 * honours { count, head }, because the two Overview counts are head queries.
 *
 * `failWith` is scoped to one table so a forced failure on `applications`
 * does not also break the role lookup that runs before it.
 */
writeFileSync(`${OUT}/stub-sb.js`, `
const S = () => globalThis.__ar;
function table(name) {
  const filters = [];
  let head = false;
  const run = () => {
    const st = S();
    if (st.failWith && st.failWith.table === name) {
      return { data: null, count: null, error: { message: st.failWith.message } };
    }
    const rows = (st.db[name] ?? []).filter((r) =>
      filters.every(([c, v]) =>
        c.startsWith("!") ? r[c.slice(1)] !== v
        : c.startsWith("=") ? (r[c.slice(1)] ?? null) === v
        : c.startsWith(">") ? String(r[c.slice(1)] ?? "") >= String(v)
        : c.startsWith("*") ? (r[c.slice(1)] ?? null) !== null
        : r[c] === v,
      ),
    );
    return head
      ? { data: null, count: st.missingCount ? null : rows.length, error: null }
      : { data: rows.map((r) => ({ ...r })), count: rows.length, error: null };
  };
  const api = {
    select: (_cols, opts) => { if (opts && opts.head) head = true; return api; },
    eq: (c, v) => (filters.push([c, v]), api),
    neq: (c, v) => (filters.push(["!" + c, v]), api),
    is: (c, v) => (filters.push(["=" + c, v]), api),
    not: (c, _op, _v) => (filters.push(["*" + c, null]), api),
    gte: (c, v) => (filters.push([">" + c, v]), api),
    order: () => api,
    limit: () => api,
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  };
  return api;
}
export const supabaseAdmin = {
  from: table,
  auth: { admin: { getUserById: async (id) => ({ data: { user: { email: S().emails[id] ?? null } } }) } },
};
export const supabase = supabaseAdmin;
export default supabaseAdmin;
`);

for (const [src, out] of [
  ["src/lib/admin-overview.ts", "rules.mjs"],
  ["src/lib/admin-overview.functions.ts", "fn.mjs"],
]) {
  execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${OUT}/${out}`, "--alias:@=./src",
    `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
    `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
    `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub-auth.js`,
    `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`],
    { stdio: ["ignore", "ignore", "inherit"] });
}
const R = await import(`../${OUT}/rules.mjs`);
const FN = await import(`../${OUT}/fn.mjs`);

const OWNER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const COORD = "33333333-3333-4333-8333-333333333333";
const DRIVER = "44444444-4444-4444-8444-444444444444";
const A1 = "55555555-5555-4555-8555-555555555555";
const recent = new Date(Date.now() - 2 * 864e5).toISOString();

/** A complete applications row, identity columns and all. */
const ROW = {
  id: A1, full_name: "Dana Reyes", email: "dana@example.com", phone: "8135550142",
  city: "Tampa", state: "FL", status: "reviewing", current_step: "part2",
  created_at: recent, reviewed_at: null, deleted_at: null,
  // Readiness inputs. These are the four columns 0030 deliberately withholds,
  // and the dashboard was shipping all four to every staff browser.
  platforms: ["uber"], trips_completed: "500+", rating: 4.9,
  start_timing: "this_week", pickup_date: "2026-10-20", drive_type: "rideshare",
  license_valid: true, license_photo_url: "licences/dana.jpg", years_licensed: 7,
  full_coverage_insurance: true, insurance_answer: "yes",
  insurance_doc_url: "ins/dana.pdf", insurance_rideshare_endorsement: true,
  profile_screenshot_url: "gig/dana.png", trip_screenshots: ["t1.png"],
  gig_status: "active",
  // Never readiness inputs, never displayed, never permitted out.
  license_number: "R123-456-78-901-0", dob: "1991-07-02", address: "1200 N Ashley Dr",
  zip: "33602", card_last4: "4242", weekly_rent: 329, notes: "internal note",
  ai_score: 71, user_id: DRIVER,
};
const NEW_UNOPENED = { ...ROW, id: "a1000000-0000-4000-8000-000000000001", status: "new", reviewed_at: null };
const NEW_OPENED = { ...ROW, id: "a1000000-0000-4000-8000-000000000002", status: "new", reviewed_at: recent };
const PARTIAL = { ...ROW, id: "a1000000-0000-4000-8000-000000000003", status: "partial" };
const DUPE = { ...ROW, id: "a1000000-0000-4000-8000-000000000004", status: "duplicate" };
const GONE = { ...ROW, id: "a1000000-0000-4000-8000-000000000005", deleted_at: recent };

function reset(extra) {
  globalThis.__ar = {
    emails: { [OWNER]: "owner@drivereal.com", [MANAGER]: "manager@drivereal.com", [COORD]: "rosa@drivereal.com" },
    failWith: null,
    db: {
      user_roles: [
        { user_id: OWNER, role: "admin" },
        { user_id: MANAGER, role: "team" },
        { user_id: COORD, role: "coordinator" },
      ],
      applications: [ROW, NEW_UNOPENED, NEW_OPENED, PARTIAL, DUPE, GONE],
      driver_screenings: [{ lead_id: A1, mvr_status: "clear" }],
      documents: [{ lead_id: A1, driver_id: A1, category: "license_front", review_status: "approved", is_current: true }],
    },
    ...extra,
  };
}
reset();

const overview = (userId) => FN.getOverviewApplicants({ context: { userId } });
const notifications = (userId) => FN.getAdminNotifications({ context: { userId } });
async function refused(run) {
  try { await run(); return null; } catch (e) { return String(e?.message ?? e); }
}
/** Every key present anywhere in a serialised payload. */
const keysOf = (v) => new Set(JSON.stringify(v).match(/"[^"]+":/g)?.map((k) => k.slice(1, -2)) ?? []);

// ================================================= Owner and Manager
console.log("\nan Owner and a Manager get the dashboard they always had");
for (const [who, id] of [["an Owner", OWNER], ["a Manager", MANAGER]]) {
  reset();
  const res = await overview(id);
  ok(res.canSeeReadiness === true, `${who} is told readiness is included`);
  ok(res.newApps === 1, `${who} sees 1 New — finished the wizard, nobody opened it`);
  ok(res.pendingApps === 1, `${who} sees 1 Pending`);
  ok(res.applicants.length === 4, `${who} gets the window without the duplicate or the deleted applicant`);
  ok(!res.applicants.some((a) => a.id === DUPE.id), `  the duplicate is excluded`);
  ok(!res.applicants.some((a) => a.id === GONE.id), `  the soft-deleted applicant is excluded`);
  ok(!!res.readiness[A1], `${who} gets a computed readiness verdict`);
  ok(typeof res.readiness[A1].state === "string", `  the verdict carries a state`);
}

// ================================================= the identity columns
console.log("\nthe readiness evidence never leaves the server, for anybody");
for (const [who, id] of [["an Owner", OWNER], ["a Manager", MANAGER], ["a Coordinator", COORD]]) {
  reset();
  const res = await overview(id);
  const keys = keysOf(res.applicants);
  for (const f of ["license_photo_url", "insurance_doc_url", "profile_screenshot_url", "trip_screenshots"]) {
    ok(!keys.has(f), `${who}: ${f} is absent from the applicant rows`);
  }
  const blob = JSON.stringify(res.applicants);
  ok(!blob.includes("licences/dana.jpg"), `${who}: the licence photo path is nowhere in the payload`);
  ok(!blob.includes("R123-456-78-901-0"), `${who}: the licence number is nowhere in the payload`);
  ok(!blob.includes("1991-07-02"), `${who}: the date of birth is nowhere in the payload`);
  ok(!blob.includes("4242"), `${who}: the card digits are nowhere in the payload`);
  ok(res.applicants.every((a) => R.isOverviewSafe(a)), `${who}: every row is clean by the named policy`);
}

// ================================================= Coordinator
console.log("\na Coordinator works the pipeline without the evidence");
reset();
{
  const res = await overview(COORD);
  ok(res.applicants.length === 4, "a Coordinator's list is NOT empty");
  ok(res.canSeeReadiness === false, "a Coordinator is told readiness is withheld");
  ok(Object.keys(res.readiness).length === 0, "and no verdict is sent at all");
  ok(res.newApps === 1 && res.pendingApps === 1, "the operational counts still arrive");
  const a = res.applicants.find((x) => x.id === A1);
  for (const f of ["id", "full_name", "status", "current_step", "created_at", "reviewed_at"])
    ok(Object.prototype.hasOwnProperty.call(a, f), `  a Coordinator still gets ${f}`);
  ok(Object.keys(a).length === 6, "  and exactly those six fields, nothing more");
}

// ================================================= refusals
console.log("\na driver and an anonymous caller are refused");
for (const [who, id] of [["a driver", DRIVER], ["an anonymous caller", null]]) {
  reset();
  ok(await refused(() => overview(id)), `${who} is refused the Overview read`);
  reset();
  ok(await refused(() => notifications(id)), `${who} is refused the notification read`);
}

// ================================================= notifications
console.log("\nthe notification bell carries contact details and nothing else");
for (const [who, id] of [["an Owner", OWNER], ["a Coordinator", COORD]]) {
  reset();
  const res = await notifications(id);
  ok(res.rows.length === 5, `${who} gets the recent applicants, minus the deleted one`);
  ok(!res.rows.some((r) => r.id === GONE.id), `  the soft-deleted applicant is excluded`);
  const keys = keysOf(res.rows);
  ok(keys.has("full_name") && keys.has("email") && keys.has("phone"), `${who}: name, email and phone are present`);
  for (const f of ["license_number", "dob", "address", "card_last4", "weekly_rent", "notes", "ai_score", "license_photo_url"])
    ok(!keys.has(f), `${who}: ${f} is absent`);
  ok(res.rows.every((r) => R.isOverviewSafe(r)), `${who}: every row is clean by the named policy`);
}

// ================================================= failures are not zeros
console.log("\na failed read is reported, never rendered as zero");
reset({ failWith: { table: "applications", message: "permission denied for table applications" } });
{
  const msg = await refused(() => overview(OWNER));
  ok(!!msg, "a failed applications read throws rather than returning counts");
  ok(/permission denied/.test(msg ?? ""), "  and the real reason survives to the caller");
}
reset({ failWith: { table: "applications", message: "permission denied for table applications" } });
ok(!!(await refused(() => notifications(OWNER))), "a failed notification read throws too");
reset({ failWith: { table: "driver_screenings", message: "screenings unavailable" } });
ok(!!(await refused(() => overview(OWNER))), "a failed screening read throws rather than silently dropping readiness");
reset({ failWith: { table: "documents", message: "documents unavailable" } });
ok(!!(await refused(() => overview(OWNER))), "a failed document read throws rather than scoring on partial evidence");

reset({ missingCount: true });
ok(!!(await refused(() => overview(OWNER))), "missing exact count never becomes a successful zero");

// ================================================= 0030 structural promises
console.log("\nthe 0030 promises this repair has to keep");
const panel = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const fnSrc = readFileSync("src/lib/admin-overview.functions.ts", "utf8");
ok(!/from\(["']applications["']\)/.test(panel), "OverviewPanel makes no direct applications query");
ok(!/from\(["']applications["']\)/.test(admin), "admin.tsx makes no direct applications query");
ok(!/from\(["']driver_screenings["']\)/.test(panel), "OverviewPanel reads no screening in the browser");
ok(!/from\(["']documents["']\)/.test(panel), "OverviewPanel reads no document in the browser");
ok(/getOverviewApplicants/.test(panel), "OverviewPanel goes through the server function");
ok(/getAdminNotifications/.test(admin), "admin.tsx goes through the server function");
ok(/requireStaff/.test(fnSrc), "both reads are staff-gated");
ok(/tierAllows\(actor\.tier, "manager"\)/.test(fnSrc), "and the tier decides readiness");
ok(/supabaseAdmin/.test(fnSrc), "the read goes through the service role, which 0030 does not govern");
ok(!/GRANT|CREATE POLICY|service_role/i.test(fnSrc.replace(/supabaseAdmin/g, "")),
  "no grant, policy or RLS exception is introduced");
ok(/data-applicants-state/.test(panel), "a failed applicant read renders a distinct state");
ok(/Could Not Load Applications/.test(panel), "  and says so rather than 'No Applications Yet'");
ok(/data-notifs-state/.test(admin), "a failed notification read renders a distinct state");
ok(/Could Not Load Activity/.test(admin), "  and says so rather than 'No Recent Activity'");
ok(/const \[newApps, setNewApps\] = useState<number \| null>\(null\)/.test(panel),
  "the New count starts unknown, not zero");
ok(/const \[pendingApps, setPendingApps\] = useState<number \| null>\(null\)/.test(panel),
  "the Pending count starts unknown, not zero");
ok(/Counts Unavailable/.test(panel), "and a failed read says the counts are unavailable");
ok(/canSeeReadiness && <option value="readiness">/.test(panel),
  "the Readiness sort is hidden from a tier that has no readiness");

// ================================================= untouched neighbours
console.log("\nnothing else on this branch moved");
const base = (f) => execFileSync("git", ["show", `origin/main:${f}`], { encoding: "utf8" });
for (const f of [
  "src/lib/contact-status.ts",
  "src/lib/contact-status.functions.ts",
  "src/lib/drivers-list.ts",
  "src/lib/drivers-list.functions.ts",
  "src/lib/bookings.functions.ts",
  "src/lib/documents.functions.ts",
  "src/lib/applications.functions.ts",
  "src/lib/agreements.functions.ts",
  "src/lib/readiness.ts",
  "src/lib/readiness-index.ts",
]) {
  ok(base(f) === readFileSync(f, "utf8"), `  ${f.replace("src/lib/", "")} is untouched`);
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall admin read access checks pass");
process.exit(fail ? 1 : 0);
