/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   CONTACT STATUS AND APPLICATION STATUS ARE SEPARATE. A CONTACT WRITE
 *   NEVER TOUCHES THE LIFECYCLE, AND NEVER APPROVES OR DECLINES ANYBODY.
 *   OWNER, MANAGER AND COORDINATOR MAY SET IT. NOBODY ELSE — CHECKED ON
 *   THE SERVER, WHERE THE SERVICE ROLE BYPASSES RLS.
 *   A STATUS ASKS ONLY FOR THE FIELDS IT USES, AND THE SERVER RE-CHECKS
 *   THE SAME RULES THE POPOVER USED.
 *   EVERY CHANGE RECORDS WHO AND WHEN.
 *   A NEW APPLICANT IS NEW.
 *
 * The real server module is bundled and driven here — the framework and the
 * Supabase client are stubbed, nothing else is. A test that re-implemented
 * the permission check would pass while the real one was missing.
 *
 * Run: node scripts/contact-status.test.mjs   (npm run test:contact)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".contact-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- the stubs
//
// createServerFn also runs the module's own inputValidator, so the zod schema
// is part of what is under test: a forged status or a malformed date must be
// refused before the handler sees it.
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
writeFileSync(`${OUT}/stub-start-server.js`, `
export const getRequest = () => ({ headers: new Map() });
`);
writeFileSync(`${OUT}/stub-auth.js`, `export const requireSupabaseAuth = {};`);

// A small slice of PostgREST over in-memory rows, recording every write.
writeFileSync(`${OUT}/stub-sb.js`, `
// Read through on every call, never captured: reset() installs a NEW world
// between scenarios, and a stub holding the first one reported writes against
// a database nobody was looking at any more.
const S = () => globalThis.__contact;
function table(name) {
  const filters = [];
  let cap, payload = null, kind = "select";
  const rows = () => {
    const all = (S().db[name] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    return cap == null ? all : all.slice(0, cap);
  };
  const result = () => {
    // failWith stands for the database refusing THIS table — a missing column
    // on applications. Applying it to user_roles too would refuse the tier
    // lookup first, and the test would be watching the wrong refusal.
    if (S().failWith && name === "applications") return { data: null, error: S().failWith };
    if (kind === "update") {
      const hit = rows();
      S().writes.push({ table: name, patch: payload, ids: hit.map((r) => r.id) });
      for (const r of hit) Object.assign(r, payload);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (kind === "insert") {
      S().inserts.push({ table: name, row: payload });
      (S().db[name] ??= []).push(payload);
      return { data: [payload], error: null };
    }
    // Copies. A real select hands back a snapshot; handing back the live row
    // let the UPDATE below rewrite the "before" values under the caller, and
    // the audit entry then claimed nothing had changed.
    return { data: rows().map((r) => ({ ...r })), error: null };
  };
  const api = {
    select: () => api,
    eq: (c, v) => (filters.push([c, v]), api),
    is: (c, v) => (filters.push([c, v]), api),
    order: () => api,
    limit: (n) => ((cap = n), api),
    update: (p) => ((kind = "update"), (payload = p), api),
    insert: (p) => ((kind = "insert"), (payload = p), api),
    maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (res, rej) => Promise.resolve(result()).then(res, rej),
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
  ["src/lib/contact-status.ts", "pure.mjs"],
  ["src/lib/contact-status.functions.ts", "fn.mjs"],
]) {
  execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${OUT}/${out}`, "--alias:@=./src",
    `--alias:@tanstack/react-start=./${OUT}/stub-start.js`,
    `--alias:@tanstack/react-start/server=./${OUT}/stub-start-server.js`,
    "--alias:@/integrations/supabase/auth-middleware=./" + OUT + "/stub-auth.js",
    `--alias:@/integrations/supabase/client.server=./${OUT}/stub-sb.js`],
    { stdio: ["ignore", "ignore", "inherit"] });
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const COORD = "33333333-3333-4333-8333-333333333333";
const DRIVER = "44444444-4444-4444-8444-444444444444";
const APP = "55555555-5555-4555-8555-555555555555";
const GHOST = "66666666-6666-4666-8666-666666666666";

/** A clean world: three staff, one driver with no grant, one applicant. */
function reset(appOverrides = {}) {
  globalThis.__contact = {
    failWith: null,
    writes: [],
    inserts: [],
    emails: { [OWNER]: "owner@drivereal.com", [MANAGER]: "manager@drivereal.com", [COORD]: "rosa@drivereal.com" },
    db: {
      user_roles: [
        { user_id: OWNER, role: "admin" },
        { user_id: MANAGER, role: "team" },
        { user_id: COORD, role: "coordinator" },
      ],
      applications: [{
        id: APP,
        full_name: "Dana Reyes",
        status: "reviewing",
        deleted_at: null,
        contact_status: "new",
        contact_status_note: null,
        contact_follow_up_on: null,
        contact_status_at: null,
        contact_status_by: null,
        ...appOverrides,
      }],
      audit_log: [],
    },
  };
}
reset();

const D = await import(`../${OUT}/pure.mjs`);
const FN = await import(`../${OUT}/fn.mjs`);

const set = (userId, data) => FN.setContactStatus({ data, context: { userId } });
const app = () => globalThis.__contact.db.applications[0];
const audits = () => globalThis.__contact.inserts.filter((i) => i.table === "audit_log").map((i) => i.row);
/**
 * The message a call refuses with, or null if it went through.
 *
 * Takes a THUNK, not a promise: the input validator throws synchronously, so
 * `refused(() => set(...))` would blow up before this function was ever entered —
 * which is exactly how a forged status looked like a crash instead of a
 * refusal the first time this ran.
 */
async function refused(run) {
  try { await run(); return null; } catch (e) { return String(e?.message ?? e); }
}

// =============================================== the vocabulary
console.log("\nthe nine statuses, as the owner asked for them");
const WANT = ["New", "Attempted", "Voicemail", "Contacted", "Interested", "Follow-Up", "Documents", "Unqualified", "Unresponsive"];
ok(JSON.stringify(D.CONTACT_STATUSES.map((s) => s.label)) === JSON.stringify(WANT),
  `exactly these, in order: ${D.CONTACT_STATUSES.map((s) => s.label).join(", ")}`);
ok(D.CONTACT_STATUSES.every((s) => s.label.split(/[\s]+/).length <= 2),
  "every label is one or two words");
ok(D.CONTACT_STATUSES.every((s) => /^[A-Z]/.test(s.label) && s.label === s.label.replace(/\b([a-z])/g, (m, c) => c)),
  "and Title Case in the string itself, not by CSS");
ok(D.DEFAULT_CONTACT_STATUS === "new", "a new applicant is New");
ok(D.normalizeContactStatus("Follow-Up") === null && D.normalizeContactStatus("follow_up") === "follow_up",
  "the stored value is the key, and a label is not a key");
ok(D.normalizeContactStatus("approved") === null && D.normalizeContactStatus("declined") === null,
  "an APPLICATION status is not a contact status");

// =============================================== fields per status
console.log("\na status asks only for what it uses");
ok(D.contactStatusForm("new").followUp === "off", "New asks for no follow-up date");
ok(D.contactStatusForm("unqualified").followUp === "off", "nor does Unqualified");
ok(D.contactStatusForm("follow_up").followUp === "required", "Follow-Up requires the date — that is the whole status");
ok(D.contactStatusForm("unqualified").note === "required", "Unqualified requires the reason");
ok(["attempted", "voicemail", "contacted", "interested", "documents", "unresponsive"]
  .every((k) => D.contactStatusForm(k).note === "optional" && D.contactStatusForm(k).followUp === "optional"),
  "and the rest take an optional note and an optional date");

console.log("\nthe rules that stop a useless entry");
ok(D.contactStatusBlockers({ status: "follow_up", note: "call back" }).some((b) => b.field === "followUpOn"),
  "Follow-Up with no date is blocked");
ok(D.contactStatusBlockers({ status: "follow_up", followUpOn: "2026-10-14" }).length === 0,
  "  and allowed with one");
ok(D.contactStatusBlockers({ status: "unqualified", note: "" }).some((b) => b.field === "note"),
  "Unqualified with no reason is blocked");
ok(D.contactStatusBlockers({ status: "contacted", followUpOn: "next tuesday" }).some((b) => b.field === "followUpOn"),
  "a typed-out date is not a date");
ok(D.contactStatusBlockers({ status: "nonsense" }).some((b) => b.field === "status"),
  "a status nobody defined is blocked");
ok(D.contactStatusBlockers({ status: "contacted", note: "x".repeat(1001) }).some((b) => b.field === "note"),
  "and a note longer than the column allows");

console.log("\nvalues a status has no use for are cleared, not carried");
const cleared = D.contactStatusPatch({ status: "unqualified", note: "No commercial insurance", followUpOn: "2026-10-14" });
ok(cleared.contact_follow_up_on === null,
  "moving to Unqualified drops the old follow-up date rather than leaving a call nobody will make");
ok(D.contactStatusPatch({ status: "contacted", note: "   ", followUpOn: "" }).contact_status_note === null,
  "and a note of spaces is no note");

console.log("\nreading the fields off a row");
ok(D.readContactStatus({ contact_status: "interested" }).supported === true, "a row with the column is supported");
ok(D.readContactStatus({ full_name: "Dana" }).supported === false,
  "a row WITHOUT it is reported unsupported — that is a database missing the migration");
ok(D.readContactStatus({ full_name: "Dana" }).state.status === "new",
  "  and still reads as New rather than blank");

// =============================================== permissions
console.log("\nOwner, Manager and Coordinator may set a contact status");
for (const [who, id] of [["an Owner", OWNER], ["a Manager", MANAGER], ["a Coordinator", COORD]]) {
  reset();
  const res = await set(id, { applicationId: APP, status: "contacted", note: "Spoke to them" });
  ok(res?.state?.status === "contacted", `${who} can set it (${res?.state?.status})`);
  ok(app().contact_status === "contacted", `  and the row is saved`);
}

console.log("\nnobody else can, and the check is on the server");
reset();
let msg = await refused(() => set(DRIVER, { applicationId: APP, status: "interested" }));
ok(/forbidden/i.test(msg ?? ""), `a signed-in driver with no staff grant is refused (${msg})`);
ok(app().contact_status === "new", "  and nothing was written");
reset();
msg = await refused(() => set("", { applicationId: APP, status: "interested" }));
ok(msg !== null, `an anonymous caller is refused (${msg})`);
ok(app().contact_status === "new", "  and nothing was written");
reset();
msg = await refused(() => set(DRIVER, { applicationId: APP, status: "new" }));
ok(/forbidden/i.test(msg ?? ""), "  not even to the default value");

console.log("\nthe server re-checks the rules the popover used");
reset();
msg = await refused(() => set(COORD, { applicationId: APP, status: "follow_up" }));
ok(/follow-up date/i.test(msg ?? ""), `Follow-Up with no date is refused server-side (${msg})`);
ok(app().contact_status === "new", "  and nothing was written");
reset();
msg = await refused(() => set(COORD, { applicationId: APP, status: "unqualified" }));
ok(/reason/i.test(msg ?? ""), `Unqualified with no reason is refused server-side (${msg})`);
reset();
msg = await refused(() => set(COORD, { applicationId: APP, status: "closed" }));
ok(msg !== null, `an application status cannot be smuggled in as a contact status (${msg})`);
reset();
msg = await refused(() => set(COORD, { applicationId: APP, status: "contacted", followUpOn: "10-14-2026" }));
ok(msg !== null, `a display-formatted date is refused (${msg})`);
reset();
msg = await refused(() => set(COORD, { applicationId: GHOST, status: "contacted" }));
ok(/no longer exists/i.test(msg ?? ""), `a forged application id is refused (${msg})`);

// =============================================== the lifecycle is untouched
console.log("\nTHE APPLICATION LIFECYCLE IS NOT TOUCHED");
reset();
await set(COORD, { applicationId: APP, status: "unqualified", note: "No rideshare endorsement" });
const patch = globalThis.__contact.writes.find((w) => w.table === "applications")?.patch ?? {};
ok(Object.keys(patch).every((k) => k.startsWith("contact_")),
  `the write carries only contact_* columns: ${Object.keys(patch).join(", ")}`);
ok(!("status" in patch) && !("reviewed_at" in patch) && !("reviewed_by" in patch),
  "  no status, no reviewed_at, no reviewed_by");
ok(app().status === "reviewing",
  "and marking somebody Unqualified leaves their application exactly where it was");
ok(globalThis.__contact.writes.filter((w) => w.table !== "audit_log").every((w) => w.table === "applications"),
  "nothing else in the database is written at all");

// =============================================== who and when
console.log("\nwho changed it, and when");
reset();
const before = Date.now() - 1000;
await set(COORD, { applicationId: APP, status: "voicemail", note: "Left a message" });
ok(app().contact_status_by === COORD, "the row records who set it");
ok(new Date(app().contact_status_at).getTime() >= before, "  and when");
const entry = audits()[0];
ok(entry?.action === "contact_status.set", `an audit entry is written (${entry?.action})`);
ok(entry?.actor_email === "rosa@drivereal.com" && entry?.actor_role === "coordinator",
  `  naming the actor (${entry?.actor_email} / ${entry?.actor_role})`);
ok(entry?.entity_type === "application" && entry?.entity_id === APP, "  against the right record");
ok(entry?.metadata?.from?.status === "new" && entry?.metadata?.to?.status === "voicemail",
  "  with the before and after status");
ok(entry?.metadata?.to?.note === "Left a message", "  and what was entered with it");
ok(/Voicemail/.test(String(entry?.summary)) && /Dana Reyes/.test(String(entry?.summary)),
  `  and one line a human can read: "${entry?.summary}"`);

console.log("\nand the history reads back out of the audit log");
reset();
await set(COORD, { applicationId: APP, status: "attempted" });
await set(MANAGER, { applicationId: APP, status: "interested", note: "Wants the Camry" });
const hist = await FN.getContactStatusHistory({ data: { applicationId: APP }, context: { userId: COORD } });
ok(hist.length === 2, `both changes are there (${hist.length})`);
ok(hist.some((h) => h.to === "interested" && h.note === "Wants the Camry"), "  with the note that came with them");
ok(hist.every((h) => h.actor), "  and the staff member who made each one");
msg = await refused(() => FN.getContactStatusHistory({ data: { applicationId: APP }, context: { userId: DRIVER } }));
ok(/forbidden/i.test(msg ?? ""), `a driver cannot read the contact history (${msg})`);

// =============================================== the migration is honest
console.log("\nwithout its migration, it says so rather than losing the note");
// Three shapes of the same answer: Postgres' undefined-column on a select,
// PostgREST's schema cache refusing an update for a column it has never heard
// of (its message does not name one), and an older PostgREST that only says
// it in words.
for (const [what, err] of [
  ["an undefined column on the read", { code: "42703", message: 'column applications.contact_status does not exist' }],
  ["a schema cache that has never heard of the column", { code: "PGRST204", message: "Could not find the column in the schema cache" }],
  ["a server that only says it in words", { code: null, message: "contact_follow_up_on is not a column" }],
]) {
  reset();
  globalThis.__contact.failWith = err;
  msg = await refused(() => set(COORD, { applicationId: APP, status: "contacted", note: "Spoke to them" }));
  ok(/migration/i.test(msg ?? ""), `${what} is reported as the missing migration (${msg})`);
  ok(!/42703|PGRST204/.test(msg ?? ""), "  in words, not an error code");
}

// =============================================== the SQL
console.log("\nthe migration is additive and leaves the lifecycle alone");
const SQL = readFileSync("supabase/migrations/20261011180000_contact_status.sql", "utf8");
const sql = SQL.replace(/--[^\n]*/g, "");
ok(/ADD COLUMN IF NOT EXISTS contact_status text NOT NULL DEFAULT 'new'/.test(sql),
  "contact_status defaults to 'new', so every existing applicant reads as New with no back-fill");
ok(/contact_follow_up_on date/.test(sql), "the follow-up is a DATE, so it cannot shift by a timezone");
ok(/contact_status_at timestamptz/.test(sql) && /contact_status_by uuid/.test(sql), "who and when are stored");
for (const forbidden of [/DROP TABLE/i, /DROP COLUMN/i, /\bUPDATE\s+public\.applications\b/i, /ALTER TYPE/i, /DELETE\s+FROM/i]) {
  ok(!forbidden.test(sql), `no ${String(forbidden)} in the migration`);
}
ok(!/CREATE POLICY|DROP POLICY/i.test(sql),
  "no policy is created or dropped — applications already gates staff read/update, and a driver has SELECT only");
ok(!/CREATE TRIGGER|DROP TRIGGER/i.test(sql), "and no trigger is added to the lifecycle");
const checked = (sql.match(/applications_contact_status_check[\s\S]*?\)\s*\)/) ?? [""])[0];
ok(D.CONTACT_STATUSES.every((s) => checked.includes(`'${s.key}'`)),
  "the CHECK constraint lists all nine statuses");
ok(/CREATE INDEX IF NOT EXISTS applications_contact_status_idx/.test(sql), "the filter has an index");

// =============================================== the UI keeps them apart
console.log("\nthe Drivers list keeps the two columns separate");
const PANEL = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
ok(/>\s*Contact Status\s*</.test(PANEL), "there is a Contact Status column, in Title Case");
ok(/>\s*Status\s*</.test(PANEL), "  beside the existing application Status column");
ok(/contactFilter/.test(PANEL) && /data-contact-filter/.test(PANEL), "and a Contact Status filter of its own");
ok(/useState<string>\("all"\);\s*\n/.test(PANEL) && PANEL.includes("const [contactFilter"),
  "  held separately from the application filter, so staff can use both at once");
ok(!/update\([^)]*contact_status/.test(PANEL),
  "the lifecycle writer is never handed a contact status");
const CELL = readFileSync("src/components/admin/ContactStatusCell.tsx", "utf8");
for (const forbidden of ['from("applications")', ".update(", "supabaseAdmin", ".insert("]) {
  ok(!CELL.includes(forbidden), `the cell does not reach the database itself (${forbidden})`);
}
ok(/useServerFn\(setContactStatus\)/.test(CELL), "it calls the server function, which checks the tier");
ok(/contactStatusBlockers/.test(CELL) && /contactStatusForm/.test(CELL),
  "and shows the same fields and rules the server enforces");
ok(/Not Enabled/.test(CELL), "with an honest badge while the migration is pending");
ok(/w-\[min\(20rem,calc\(100vw-2rem\)\)\]/.test(CELL), "the popover fits a phone");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} blocker(s)` : "\nall Contact Status checks pass");
process.exit(fail ? 1 : 0);
