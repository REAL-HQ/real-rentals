/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   THE DRIVERS LIST IS READ ON THE SERVER, AND THE TIER DECIDES WHAT
 *   COMES BACK. A COORDINATOR GETS THE FIELDS THEY NEED TO WORK A LEAD
 *   AND SET A CONTACT STATUS. THE LICENCE, THE DATE OF BIRTH, THE
 *   ADDRESS AND THE CARD ARE ABSENT FROM THEIR ANSWER.
 *
 * Security migration 0031 removes a Coordinator's direct read of
 * public.applications. The Drivers list used to be
 * supabase.from("applications").select("*") in the browser, so under 0031 it
 * would simply go empty for them — and handing the table back would hand
 * back the licence number with it.
 *
 * The repair is a server read with a field policy. This drives the REAL
 * module: only the framework and the Supabase client are stubbed, so a test
 * that passes while the projection is missing is not possible.
 *
 * Run: node scripts/drivers-list-access.test.mjs   (npm run test:drivers-list)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".driverslist-build";
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
writeFileSync(`${OUT}/stub-sb.js`, `
const S = () => globalThis.__dl;
function table(name) {
  const filters = [];
  const api = {
    select: () => api,
    eq: (c, v) => (filters.push([c, v]), api),
    neq: (c, v) => (filters.push(["!" + c, v]), api),
    // is() is implemented, not a no-op: the real query excludes deleted
    // applicants with .is("deleted_at", null), and a stub that ignores it
    // would report a soft-deleted person as still on the list.
    is: (c, v) => (filters.push(["=" + c, v]), api),
    order: () => api, limit: () => api,
    then: (res, rej) => {
      const rows = (S().db[name] ?? []).filter((r) =>
        filters.every(([c, v]) =>
          c.startsWith("!")
            ? r[c.slice(1)] !== v
            : c.startsWith("=")
              ? (r[c.slice(1)] ?? null) === v
              : r[c] === v,
        ),
      );
      return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(res, rej);
    },
    maybeSingle: async () => ({ data: (S().db[name] ?? [])[0] ?? null, error: null }),
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
  ["src/lib/drivers-list.ts", "rules.mjs"],
  ["src/lib/drivers-list.functions.ts", "fn.mjs"],
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

/** A complete applications row, sensitive fields and all. */
const ROW = {
  id: A1, full_name: "Dana Reyes", phone: "8135550142", email: "dana@example.com",
  city: "Tampa", state: "FL", status: "reviewing", created_at: "2026-10-01T10:00:00Z",
  contacted_at: null, primary_application_id: null, resubmission_count: 0, deleted_at: null,
  vehicle_id: null, gclid: null, utm_campaign: "tampa-gig",
  contact_status: "follow_up", contact_status_note: "Wants the Camry",
  contact_follow_up_on: "2026-10-14", contact_status_at: "2026-10-11T12:00:00Z",
  contact_status_by: COORD,
  // Everything below must never reach a Coordinator.
  license_number: "R123-456-78-901-0", license_state: "FL", license_expiration: "2030-04-30",
  license_photo_url: "licences/dana.jpg", license_valid: true, dob: "1991-07-02",
  address: "1200 N Ashley Dr", zip: "33602",
  insurance_carrier: "Progressive", insurance_policy_number: "PP-99812",
  insurance_doc_url: "ins/dana.pdf", profile_screenshot_url: "gig/dana.png",
  trip_screenshots: ["t1.png"], card_brand: "visa", card_last4: "4242",
  card_exp_month: 10, card_exp_year: 2030, stripe_customer_id: "cus_x",
  stripe_payment_method_id: "pm_x", deposit_amount: 300, deposit_paid: 300,
  weekly_rent: 329, notes: "internal note", ai_summary: "looks fine", ai_flags: [],
  ai_score: 71, score: 71, user_id: DRIVER, requested_docs: {}, resubmission_history: [],
};
const DUPE = { ...ROW, id: "66666666-6666-4666-8666-666666666666", status: "duplicate" };
const GONE = { ...ROW, id: "77777777-7777-4777-8777-777777777777", deleted_at: "2026-10-05T00:00:00Z" };

function reset() {
  globalThis.__dl = {
    emails: { [OWNER]: "owner@drivereal.com", [MANAGER]: "manager@drivereal.com", [COORD]: "rosa@drivereal.com" },
    db: {
      user_roles: [
        { user_id: OWNER, role: "admin" },
        { user_id: MANAGER, role: "team" },
        { user_id: COORD, role: "coordinator" },
      ],
      applications: [ROW, DUPE, GONE],
    },
  };
}
reset();

const list = (userId) => FN.listDriverRows({ context: { userId } });
async function refused(run) {
  try { await run(); return null; } catch (e) { return String(e?.message ?? e); }
}

// =============================================== Owner and Manager
console.log("\nan Owner and a Manager see the list they always saw");
for (const [who, id] of [["an Owner", OWNER], ["a Manager", MANAGER]]) {
  reset();
  const res = await list(id);
  ok(res.canSeeSensitive === true, `${who} is told the rows are complete`);
  ok(res.rows.length === 1, `  and gets the live applicant only (${res.rows.length})`);
  ok(res.rows[0].license_number === "R123-456-78-901-0", "  with the licence number still there");
  ok(res.rows[0].dob === "1991-07-02" && res.rows[0].card_last4 === "4242",
    "  and the date of birth and card digits");
  ok(Object.keys(res.rows[0]).length === Object.keys(ROW).length,
    `  nothing was dropped (${Object.keys(res.rows[0]).length} fields)`);
}

// =============================================== Coordinator
console.log("\na Coordinator gets what they need to work the lead, and no more");
reset();
const co = await list(COORD);
ok(co.canSeeSensitive === false, "the answer says plainly that it is the operational slice");
ok(co.rows.length === 1, `the list is NOT empty under 0031 (${co.rows.length} row)`);
const row = co.rows[0];
for (const f of ["id", "full_name", "phone", "email", "city", "state", "status", "created_at"]) {
  ok(Object.prototype.hasOwnProperty.call(row, f), `  ${f} is present`);
}
console.log("\n  and Contact Status comes with it");
for (const f of ["contact_status", "contact_status_note", "contact_follow_up_on", "contact_status_at", "contact_status_by"]) {
  ok(Object.prototype.hasOwnProperty.call(row, f), `  ${f} is present`);
}
ok(row.contact_status === "follow_up" && row.contact_follow_up_on === "2026-10-14" && row.contact_status_note === "Wants the Camry",
  "  with the stored status, its date and its note intact");

console.log("\nand the sensitive fields are ABSENT, not blank");
for (const f of R.SENSITIVE_LIST_FIELDS) {
  ok(!Object.prototype.hasOwnProperty.call(row, f), `  no ${f}`);
}
ok(R.isOperationalOnly(row), "the row passes the operational-only check as a whole");
ok(!JSON.stringify(row).includes("R123-456-78-901-0"), "the licence number appears nowhere in the payload");
ok(!JSON.stringify(row).includes("4242") && !JSON.stringify(row).includes("1991-07-02"),
  "nor the card digits or the date of birth");
ok(Object.keys(row).every((k) => R.COORDINATOR_LIST_FIELDS.includes(k)),
  `every field is on the allow-list (${Object.keys(row).length} of ${R.COORDINATOR_LIST_FIELDS.length})`);

// =============================================== everyone else
console.log("\nnobody below a Coordinator reads this list at all");
reset();
let msg = await refused(() => list(DRIVER));
ok(/forbidden/i.test(msg ?? ""), `a signed-in driver is refused (${msg})`);
reset();
msg = await refused(() => list(""));
ok(msg !== null, `an anonymous caller is refused (${msg})`);

// =============================================== the same filters as before
console.log("\nthe list is the same list");
reset();
const owner = await list(OWNER);
ok(!owner.rows.some((r) => r.status === "duplicate"), "duplicates are still excluded");
ok(!owner.rows.some((r) => r.deleted_at), "and deleted applicants are still excluded");

// =============================================== 0031 compatibility
console.log("\n0031 STAYS FULLY EFFECTIVE");
const PANEL = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const code = PANEL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok(!/from\("applications"\)\s*\n?\s*\.select/.test(code) && !/from\("applications"\)\.select/.test(code),
  "the Drivers list no longer reads applications from the browser at all");
ok(/useServerFn\(listDriverRows\)/.test(code), "it calls the server read instead");
const FNSRC = readFileSync("src/lib/drivers-list.functions.ts", "utf8");
ok(/await requireStaff\(context\.userId\)/.test(FNSRC), "which checks the tier before reading anything");
ok(/tierAllows\(actor\.tier, "manager"\)/.test(FNSRC), "and decides the field set by tier, not by the caller");
ok(/supabaseAdmin/.test(FNSRC),
  "reading through the service role, so 0031's RLS change needs no exception for staff");
ok(!/grant|GRANT|policy|POLICY/.test(FNSRC),
  "the repair adds no grant and no policy — 0031 is untouched");

console.log("\nand it is one record, not a second one");
ok(/\.from\("applications"\)/.test(FNSRC), "the server reads the SAME applications row");
const RULES = readFileSync("src/lib/drivers-list.ts", "utf8");
ok(!/contact_statuses|driver_contacts|CREATE TABLE/i.test(RULES + FNSRC),
  "no parallel table, no duplicate contact-status store");
ok(!/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(FNSRC), "and the read writes nothing");

console.log("\nthe lifecycle and Bookings are untouched by this change");
const changed = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], { encoding: "utf8" })
  .split("\n").filter(Boolean);
for (const f of ["src/lib/rentals.functions.ts", "src/lib/bookings.functions.ts",
  "src/lib/agreements.functions.ts", "src/lib/contact-status.functions.ts",
  "src/lib/documents.functions.ts", "src/lib/applications.functions.ts"]) {
  ok(!changed.includes(f), `  ${f.split("/").pop()} is untouched`);
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} blocker(s)` : "\nall Drivers list access checks pass");
process.exit(fail ? 1 : 0);
