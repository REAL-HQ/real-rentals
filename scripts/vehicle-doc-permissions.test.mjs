/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   TITLE AND FINANCE PAPERWORK IS THE OWNER'S. ENFORCED ON THE SERVER.
 *
 * Three layers draw that line, and one of them disagreed. Storage says
 * private.vehicle_doc_object_owner_only(name), which lists 'title'. The server
 * said isFinanceKind(), which lists only the purchase and lien_release slots.
 * registerVehicleDoc and deleteVehicleDoc used the server's narrower list and
 * write with the ADMIN client, which bypasses RLS and the storage policies
 * both — so a Manager could permanently delete the row AND the bytes of a
 * title scan the policies would never have let them read, irreversibly.
 *
 * Hiding a button does not fix that, so this tests neither buttons nor source
 * text: it bundles the real vehicle-docs server module and calls the real
 * handlers as an Owner, a Manager and a Coordinator against a fake Supabase.
 * The assertions are about what ended up in the tables.
 *
 * Run: node scripts/vehicle-doc-permissions.test.mjs  (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const VEHICLE = "061cb5e9-27e7-48a4-b71b-5172f31af1aa";
const OUT = ".vehicledocs-build";

// ---------------------------------------------------------------- build
// The module imports the server-fn factory, the auth middleware, the role
// helpers, the admin client and the audit log at the top level. Stub exactly
// those, so the code under test is the real code.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });

writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
// The actor's tier is whatever the test sets, so one bundle covers all roles.
// esbuild INLINES these stubs into the bundle, so a module-level `export const
// state` would give the test one copy and the code under test another — which
// is how the first draft produced passes for refusals that had simply failed to
// find the row. All stub state therefore lives on globalThis, one instance.
writeFileSync(`${OUT}/stub/roles.server.js`, `
const S = (globalThis.__vdocs ??= {});
S.tier ??= "owner";
export const requireStaff = async (userId) => ({ userId, tier: S.tier, role: "admin" });
export const requireManager = async (userId) => {
  if (S.tier === "coordinator") throw new Error("Forbidden");
  return { userId, tier: S.tier, role: "admin" };
};
export const requireOwner = async (userId) => {
  if (S.tier !== "owner") throw new Error("Forbidden");
  return { userId, tier: S.tier, role: "admin" };
};
`);
writeFileSync(`${OUT}/stub/client.server.js`, `
const S = (globalThis.__vdocs ??= {});
S.rows ??= []; S.removed ??= []; S.nextId ??= 1;
const matches = (q, r) => q.eqs.every(([c, v]) => r[c] === v) && q.nots.every((c) => r[c] != null);
function from() {
  const q = { eqs: [], nots: [] };
  const filters = (self) => ({
    eq: (c, v) => (q.eqs.push([c, v]), self),
    neq: () => self,
    is: () => self,
    not: (c) => (q.nots.push(c), self),
    lte: () => self,
    in: (c, vals) => (q.eqs.push([c, vals[0]]), self),
    order: () => self,
  });
  const reader = {
    select: () => reader,
    maybeSingle: () => Promise.resolve({ data: S.rows.find((r) => matches(q, r)) ?? null, error: null }),
    single: () => Promise.resolve({ data: S.rows.find((r) => matches(q, r)) ?? null, error: null }),
    insert: (v) => ({ select: () => ({ single: () => {
      const row = { id: "doc-" + S.nextId++, ...v };
      S.rows.push(row);
      return Promise.resolve({ data: row, error: null });
    } }) }),
    update: (patch) => {
      const w = { then: (res, rej) => {
        for (const r of S.rows) if (matches(q, r)) Object.assign(r, patch);
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      } };
      Object.assign(w, filters(w));
      return w;
    },
    delete: () => {
      const w = { then: (res, rej) => {
        for (let i = S.rows.length - 1; i >= 0; i--) if (matches(q, S.rows[i])) S.rows.splice(i, 1);
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      } };
      Object.assign(w, filters(w));
      return w;
    },
    then: (res, rej) => Promise.resolve({ data: S.rows.filter((r) => matches(q, r)), error: null }).then(res, rej),
  };
  Object.assign(reader, filters(reader));
  return reader;
}
export const supabaseAdmin = {
  from,
  storage: { from: () => ({ remove: (paths) => (S.removed.push(...paths), Promise.resolve({ data: null, error: null })) }) },
};
`);
writeFileSync(`${OUT}/stub/audit.js`, `
const S = (globalThis.__vdocs ??= {});
S.entries ??= [];
export const logAudit = async (actor, e) => { S.entries.push({ tier: actor.tier, ...e }); };
`);
writeFileSync(`${OUT}/stub/experience.server.js`, `
const S = (globalThis.__vdocs ??= {});
export const ownerView = (actor) => (actor?.tier ?? S.tier) === "owner";
`);

execFileSync("npx", ["esbuild", "src/lib/vehicle-docs.functions.ts",
  "--bundle", "--platform=node", "--format=esm", "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/client.server.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub/roles.server.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit.js`,
  `--alias:@/lib/experience.server=./${OUT}/stub/experience.server.js`,
  `--outfile=${OUT}/vehicle-docs.mjs`, "--log-level=warning"], { stdio: "inherit" });

const mod = await import(`../${OUT}/vehicle-docs.mjs`);
/** The one shared store. The admin client is reached through a DYNAMIC import
 *  inside the handlers, so its stub does not run until the first call — seed
 *  the shape here rather than relying on that ordering. */
const S = (globalThis.__vdocs ??= {});
S.tier ??= "owner";
S.rows ??= [];
S.removed ??= [];
S.entries ??= [];
S.nextId ??= 1;

const as = (tier) => { S.tier = tier; };
const reset = () => { S.rows.length = 0; S.removed.length = 0; S.entries.length = 0; S.nextId = 1; };

const register = (kind, over = {}) => mod.registerVehicleDoc({
  data: { vehicleId: VEHICLE, kind, path: `${VEHICLE}/${kind}-1.pdf`, fileName: `${kind}.pdf`,
          mimeType: "application/pdf", sizeBytes: 10, expiresAt: null, notes: null, ...over },
  context: { userId: "staff-1" },
});
const del = (id) => mod.deleteVehicleDoc({ data: { id }, context: { userId: "staff-1" } });

// ================================================================ create
console.log("ONLY THE OWNER MAY ADD TITLE OR FINANCE PAPERWORK");
for (const kind of ["title", "purchase", "lien_release"]) {
  for (const tier of ["manager", "coordinator"]) {
    reset(); as(tier);
    const r = await register(kind);
    ok(r.ok === false, `${tier} cannot add ${kind}`);
    ok(S.rows.length === 0, `  and no ${kind} row was written`);
    ok(typeof r.error === "string" && /Owner/.test(r.error), `  the refusal says why (${r.error ?? "no message"})`);
  }
  reset(); as("owner");
  ok((await register(kind)).ok === true, `the Owner can add ${kind}`);
}

console.log("\nOPERATIONAL PAPERWORK IS STILL EVERY STAFF TIER'S JOB");
for (const kind of ["registration", "insurance_card", "inspection_cert", "emissions", "other"]) {
  reset(); as("coordinator");
  const r = await register(kind);
  ok(r.ok === true, `a Coordinator can add ${kind}`);
  ok(S.rows[0]?.kind === kind, `  filed as ${kind}`);
}

// ================================================================ delete
console.log("\nONLY THE OWNER MAY DELETE TITLE OR FINANCE PAPERWORK");
for (const [col, kind] of [["kind", "title"], ["category", "title"], ["kind", "purchase"], ["kind", "lien_release"]]) {
  reset();
  // A slot upload carries its class in `kind`; a Fleet Inbox original in
  // `category`. Both have to be refused.
  S.rows.push({ id: "doc-x", vehicle_id: VEHICLE, kind: col === "kind" ? kind : "unknown",
                       category: col === "category" ? kind : "unknown",
                       storage_bucket: "vehicle-docs", storage_path: "p/x.pdf" });
  as("manager");
  const r = await del("doc-x");
  ok(r.ok === false, `a Manager cannot delete a ${kind} identified by ${col}`);
  ok(S.rows.length === 1, "  the row survives");
  ok(S.removed.length === 0, "  and the file is still in storage");
  ok(/Owner/.test(r.error ?? ""), `  the refusal says why (${r.error ?? "no message"})`);
  ok(!S.entries.some((e) => e.action === "vehicle_doc.deleted"), "  nothing is logged as deleted");
}
{
  reset();
  S.rows.push({ id: "doc-t", vehicle_id: VEHICLE, kind: "title", category: "title",
                       storage_bucket: "vehicle-docs", storage_path: "p/t.pdf" });
  as("owner");
  const r = await del("doc-t");
  ok(r.ok === true, "the Owner can delete a title");
  ok(S.rows.length === 0 && S.removed.includes("p/t.pdf"), "  row and file both go");
  ok(S.entries.some((e) => e.action === "vehicle_doc.deleted"), "  and it is audited");
}
{
  reset();
  S.rows.push({ id: "doc-r", vehicle_id: VEHICLE, kind: "registration", category: "registration",
                       storage_bucket: "vehicle-docs", storage_path: "p/r.pdf" });
  as("manager");
  ok((await del("doc-r")).ok === true, "a Manager can still delete a registration");
}
{
  reset(); as("coordinator");
  let threw = false;
  try { await del("doc-nope"); } catch { threw = true; }
  ok(threw, "a Coordinator cannot delete any paperwork (requireManager still applies)");
}
{
  reset(); as("owner");
  const r = await del("doc-missing");
  ok(r.ok === false && /no longer exists/.test(r.error ?? ""),
     "deleting something already gone reports that, instead of claiming success");
  ok(!S.entries.length, "  and writes no audit entry about a document that was not there");
}

// ================================================================ path guard
console.log("\nA FILE MUST BELONG TO THE VEHICLE IT IS BEING ATTACHED TO");
{
  reset(); as("owner");
  const other = "061cb5e9-27e7-48a4-b71b-5172f31af1bb";
  ok((await register("registration", { path: `${other}/registration-1.pdf` })).ok === false,
     "a path under another vehicle's folder is refused");
  ok((await register("registration", { path: `${VEHICLE}/../${other}/x.pdf` })).ok === false,
     "  and so is a traversal");
  ok(S.rows.length === 0, "  neither wrote a row");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
