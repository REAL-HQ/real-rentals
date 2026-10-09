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
S.rows ??= []; S.links ??= []; S.vehicles ??= []; S.removed ??= []; S.files ??= {}; S.nextId ??= 1;
// Enough of PostgREST for this module: every filter is recorded and they are
// all applied together, so a chain of any length in any order still honours
// each condition. The fake that treated .is() and .in() as no-ops silently
// matched rows the real query would have excluded.
const matches = (q, r) =>
  q.eq.every(([c, v]) => r[c] === v) &&
  q.neq.every(([c, v]) => r[c] !== v) &&
  q.isNull.every((c) => r[c] == null) &&
  q.notNull.every((c) => r[c] != null) &&
  q.inList.every(([c, vals]) => vals.includes(r[c])) &&
  q.lte.every(([c, v]) => r[c] != null && r[c] <= v);
function from(table) {
  const q = { eq: [], neq: [], isNull: [], notNull: [], inList: [], lte: [] };
  const bag = () => (table === "document_vehicle_links" ? S.links : table === "vehicles" ? S.vehicles : S.rows);
  const filters = (self) => ({
    eq: (c, v) => (q.eq.push([c, v]), self),
    neq: (c, v) => (q.neq.push([c, v]), self),
    is: (c, v) => (v === null || v === undefined ? q.isNull.push(c) : q.eq.push([c, v]), self),
    not: (c, op, v) => (op === "is" && (v === null || v === "null") ? q.notNull.push(c) : null, self),
    in: (c, vals) => (q.inList.push([c, vals]), self),
    lte: (c, v) => (q.lte.push([c, v]), self),
    order: () => self,
    limit: () => self,
  });
  const reader = {
    select: () => reader,
    maybeSingle: () => Promise.resolve({ data: bag().find((r) => matches(q, r)) ?? null, error: null }),
    single: () => Promise.resolve({ data: bag().find((r) => matches(q, r)) ?? null, error: null }),
    insert: (v) => ({ select: () => ({ single: () => {
      const row = { id: "doc-" + S.nextId++, ...v };
      bag().push(row);
      return Promise.resolve({ data: row, error: null });
    } }) }),
    // document_vehicle_links is written with ignoreDuplicates, so a repeat is
    // a no-op rather than a second row.
    upsert: (v, opts) => {
      const b = bag();
      const keys = String(opts?.onConflict ?? "").split(",").map((k) => k.trim()).filter(Boolean);
      const same = (r) => keys.length > 0 && keys.every((k) => r[k] === v[k]);
      if (!b.some(same)) b.push({ id: "row-" + S.nextId++, ...v });
      return Promise.resolve({ data: null, error: null });
    },
    update: (patch) => {
      const w = { then: (res, rej) => {
        for (const r of bag()) if (matches(q, r)) Object.assign(r, patch);
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      } };
      Object.assign(w, filters(w));
      return w;
    },
    delete: () => {
      const w = { then: (res, rej) => {
        const b = bag();
        for (let i = b.length - 1; i >= 0; i--) if (matches(q, b[i])) b.splice(i, 1);
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      } };
      Object.assign(w, filters(w));
      return w;
    },
    then: (res, rej) => Promise.resolve({ data: bag().filter((r) => matches(q, r)), error: null }).then(res, rej),
  };
  Object.assign(reader, filters(reader));
  return reader;
}
export const supabaseAdmin = {
  from,
  storage: { from: () => ({
    remove: (paths) => (S.removed.push(...paths), Promise.resolve({ data: null, error: null })),
    // The bytes the browser claims to have uploaded. Keyed by path so a test
    // can hand two paths the SAME content and exercise the dedupe.
    download: (path) => {
      const body = S.files?.[path];
      if (body === undefined) return Promise.resolve({ data: null, error: { message: "not found" } });
      return Promise.resolve({ data: { arrayBuffer: async () => new TextEncoder().encode(body).buffer }, error: null });
    },
  }) },
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
S.links ??= [];
S.vehicles ??= [];
S.files ??= {};
S.removed ??= [];
S.entries ??= [];
S.nextId ??= 1;

const as = (tier) => { S.tier = tier; };
const reset = () => {
  S.rows.length = 0; S.links.length = 0; S.vehicles.length = 0;
  S.removed.length = 0; S.entries.length = 0; S.nextId = 1;
  for (const k of Object.keys(S.files)) delete S.files[k];
};

/** Registers a file, seeding bytes at its path first (the handler hashes them). */
const register = (kind, over = {}, body = null) => {
  const path = over.path ?? `${VEHICLE}/${kind}-1.pdf`;
  S.files[path] = body ?? `bytes-of-${path}`;
  return mod.registerVehicleDoc({
    data: { vehicleId: VEHICLE, kind, path, fileName: `${kind}.pdf`,
            mimeType: "application/pdf", sizeBytes: 10, expiresAt: null, notes: null, ...over },
    context: { userId: "staff-1" },
  });
};
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

// ================================================================ duplicates
console.log("\nTHE SAME FILE IS STORED ONCE AND RELATED, NOT STORED TWICE");
{
  reset(); as("owner");
  const first = await register("registration", { path: `${VEHICLE}/reg-a.pdf` }, "IDENTICAL");
  ok(first.ok === true && !first.duplicate, "the first upload is stored");
  ok(S.rows.length === 1 && S.rows[0].content_sha256, "  with a content hash, like Fleet Inbox");

  const again = await register("registration", { path: `${VEHICLE}/reg-b.pdf` }, "IDENTICAL");
  ok(again.ok === true, "re-uploading the identical file still succeeds");
  ok(again.duplicate === true, "  and says it was a duplicate");
  ok(again.id === first.id, "  pointing at the file already on file");
  ok(S.rows.length === 1, "NO SECOND ROW WAS WRITTEN");
  ok(S.removed.includes(`${VEHICLE}/reg-b.pdf`), "  and the redundant object was removed from the bucket");
  ok(S.rows[0].is_current === true, "  the document on file is still current, not superseded by itself");
}
{
  reset(); as("owner");
  const a = await register("registration", { path: `${VEHICLE}/x.pdf` }, "DIFFERENT-A");
  const b = await register("registration", { path: `${VEHICLE}/y.pdf` }, "DIFFERENT-B");
  ok(a.ok && b.ok && !b.duplicate, "a genuinely different file is stored");
  ok(S.rows.length === 2, "  as its own row");
  ok(S.rows.find((r) => r.id === a.id).is_current === false, "  superseding the previous registration");
  ok(S.rows.find((r) => r.id === b.id).is_current === true, "  which the new one replaces");
}
{
  reset(); as("owner");
  const other = "061cb5e9-27e7-48a4-b71b-5172f31af1dd";
  S.files[`${other}/ins.pdf`] = "SHARED-INSURANCE";
  await mod.registerVehicleDoc({
    data: { vehicleId: other, kind: "insurance_card", path: `${other}/ins.pdf`, fileName: "ins.pdf",
            mimeType: "application/pdf", sizeBytes: 10, expiresAt: null, notes: null },
    context: { userId: "staff-1" },
  });
  const mine = await register("insurance_card", { path: `${VEHICLE}/ins.pdf` }, "SHARED-INSURANCE");
  ok(mine.duplicate === true, "one insurance card uploaded to a second car is recognised");
  ok(S.rows.length === 1, "  stored once");
  ok(S.links.some((l) => l.vehicle_id === VEHICLE), "  AND LINKED to the second car, so its slot still reads On file");
  ok(S.entries.some((e) => e.action === "vehicle_doc.linked_existing"), "  and the link is audited");
}
{
  reset(); as("owner");
  const r = await register("registration", { path: `${VEHICLE}/gone.pdf`, expiresAt: "2029-06-30" });
  ok(r.ok === true && S.rows[0].expires_at === "2029-06-30", "a typed expiry is stored on the document");
  delete S.files[`${VEHICLE}/missing.pdf`];
  const miss = await mod.registerVehicleDoc({
    data: { vehicleId: VEHICLE, kind: "registration", path: `${VEHICLE}/missing.pdf`, fileName: "m.pdf",
            mimeType: "application/pdf", sizeBytes: 10, expiresAt: null, notes: null },
    context: { userId: "staff-1" },
  });
  ok(miss.ok === false && /could not be read back/.test(miss.error),
     "a path with nothing behind it is refused instead of recording a phantom document");
}

// ================================================================ expiry
console.log("\nA LAPSING DOCUMENT WARNS WHETHER IT IS OWNED OR LINKED");
{
  reset(); as("owner");
  const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
  const other = "061cb5e9-27e7-48a4-b71b-5172f31af1cc";
  S.vehicles.push(
    { id: VEHICLE, year: 2013, make: "Ford", model: "Fusion", license_plate: "SYN100",
      plate_expires_on: null, registration_expires_on: null, insurance_expires_on: null },
    { id: other, year: 2015, make: "Toyota", model: "Camry", license_plate: "SYN200",
      plate_expires_on: null, registration_expires_on: null, insurance_expires_on: null },
  );
  // A slot upload owned by the car, and a Fleet Inbox original that is LINKED
  // to two cars and owns neither — which is every document the reader stores.
  S.rows.push(
    { id: "d-own", vehicle_id: VEHICLE, kind: "registration", expires_at: soon, is_current: true },
    { id: "d-link", vehicle_id: null, kind: "insurance_card", expires_at: soon, is_current: true },
  );
  S.links.push(
    { document_id: "d-link", vehicle_id: VEHICLE },
    { document_id: "d-link", vehicle_id: other },
  );

  const out = await mod.listExpiring({ data: {}, context: { userId: "staff-1" } });
  const forThis = out.filter((r) => r.vehicle_id === VEHICLE);
  ok(forThis.some((r) => /Registration card \(document\)/.test(r.what)),
     "the vehicle's own registration is reported");
  ok(forThis.some((r) => /Insurance card \(document\)/.test(r.what)),
     "THE LINKED FLEET INBOX ORIGINAL IS REPORTED TOO");
  ok(out.filter((r) => r.vehicle_id === other).some((r) => /Insurance card/.test(r.what)),
     "  and once for every other vehicle the same file covers");
  ok(out.every((r) => r.days >= 0 && r.days <= 45), "  all within the default horizon");
}
{
  reset(); as("owner");
  const far = new Date(Date.now() + 200 * 86400_000).toISOString().slice(0, 10);
  S.vehicles.push({ id: VEHICLE, year: 2013, make: "Ford", model: "Fusion", license_plate: null,
                    plate_expires_on: null, registration_expires_on: null, insurance_expires_on: null });
  S.rows.push({ id: "d-far", vehicle_id: null, kind: "registration", expires_at: far, is_current: true });
  S.links.push({ document_id: "d-far", vehicle_id: VEHICLE });
  const out = await mod.listExpiring({ data: {}, context: { userId: "staff-1" } });
  ok(out.length === 0, "a linked document expiring well beyond the horizon is not reported");
}
{
  reset(); as("owner");
  const soon = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
  S.vehicles.push({ id: VEHICLE, year: 2013, make: "Ford", model: "Fusion", license_plate: null,
                    plate_expires_on: null, registration_expires_on: null, insurance_expires_on: null });
  S.rows.push({ id: "d-old", vehicle_id: null, kind: "registration", expires_at: soon, is_current: false });
  S.links.push({ document_id: "d-old", vehicle_id: VEHICLE });
  const out = await mod.listExpiring({ data: {}, context: { userId: "staff-1" } });
  ok(out.length === 0, "a superseded linked document does not warn about last year's expiry");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
