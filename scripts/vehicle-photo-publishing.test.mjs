/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   A VEHICLE HAS ONE LEAD PHOTO, AND EVERY OTHER PHOTO MUST STILL BE
 *   PUBLISHABLE.
 *
 * Fourteen photographs sat on two cars and not one was on the website.
 * registerVehicleMedia decides whether a new photo is the lead image by
 * counting the vehicle's PUBLISHED photos — and the very next line writes
 * published: false, on purpose, because a person chooses listing photos. So
 * that count is always zero, "is this the first photo?" is always true, and
 * every photo is stored as the lead image. The live data agrees exactly: six
 * of six on RR-005, eight of eight on RR-006.
 *
 * Nothing complains, because the database's uniqueness rule is
 *
 *   UNIQUE (vehicle_id) WHERE (is_primary AND published)
 *
 * and none of them are published. The bill arrives when someone finally
 * publishes: the first photo goes live, and the second one — still flagged as
 * the lead image — collides with the first and is refused. Staff see a raw
 * Postgres constraint message and a photo that will not go on the site.
 *
 * So this runs the real server functions against a fake Supabase that enforces
 * that same partial unique index. Asserting on source text would not have
 * caught it; the fault is an interaction between two correct-looking lines.
 *
 * No paid service is called. No real vehicle, photo or record is touched.
 *
 * Run: node scripts/vehicle-photo-publishing.test.mjs   (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const VEHICLE = "0a1b2c3d-0000-4000-8000-000000000001";
const OTHER = "0a1b2c3d-0000-4000-8000-000000000002";
const OUT = ".vphoto-build";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });

writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => fn };
  return api;
};
`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub/roles.server.js`, `
const S = (globalThis.__vphoto ??= {});
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
writeFileSync(`${OUT}/stub/audit.js`, `
const S = (globalThis.__vphoto ??= {});
S.entries ??= [];
export const logAudit = async (actor, e) => { S.entries.push({ tier: actor.tier, ...e }); };
`);
writeFileSync(`${OUT}/stub/experience.server.js`, `
const S = (globalThis.__vphoto ??= {});
export const ownerView = (a) => (a?.tier ?? S.tier) === "owner";
`);
// A fake Supabase that enforces the REAL constraint. Without the index the
// bug is invisible, which is precisely how it shipped.
writeFileSync(`${OUT}/stub/client.server.js`, `
const S = (globalThis.__vphoto ??= {});
S.rows ??= []; S.vehicles ??= []; S.removed ??= []; S.next ??= 1;

/** UNIQUE (vehicle_id) WHERE (is_primary AND published) */
function violatesOnePrimary(rows) {
  const seen = new Set();
  for (const r of rows) {
    if (!(r.is_primary && r.published)) continue;
    if (seen.has(r.vehicle_id)) return true;
    seen.add(r.vehicle_id);
  }
  return false;
}
const UNIQUE_ERR = {
  message: 'duplicate key value violates unique constraint "vehicle_media_one_primary_idx"',
  code: "23505",
};
/** The trigger pair that keeps retouched images off the site. */
function triggers(next, prev) {
  if (next.kind === "ai_enhanced" && !prev) { next.published = false; next.provenance = "ai_enhanced"; }
  if (next.kind === "ai_enhanced" && next.published && next.review_status !== "approved") {
    return { message: "A retouched photo must be approved before it can be published" };
  }
  return null;
}

const matches = (q, r) =>
  q.eq.every(([c, v]) => r[c] === v) &&
  q.neq.every(([c, v]) => r[c] !== v) &&
  q.isNull.every((c) => r[c] == null);

function from(table) {
  const q = { eq: [], neq: [], isNull: [], order: null, desc: false };
  const bag = () => (table === "vehicles" ? S.vehicles : S.rows);
  const filters = (self) => ({
    eq: (c, v) => (q.eq.push([c, v]), self),
    neq: (c, v) => (q.neq.push([c, v]), self),
    is: (c) => (q.isNull.push(c), self),
    in: (c, vals) => (q.eq.push([c, vals[0]]), self),
    order: (c, o) => ((q.order = c), (q.desc = o?.ascending === false), self),
    limit: () => self,
  });
  const sel = () => {
    let rows = bag().filter((r) => matches(q, r));
    if (q.order) rows = [...rows].sort((a, b) => (q.desc ? (b[q.order] ?? 0) - (a[q.order] ?? 0) : (a[q.order] ?? 0) - (b[q.order] ?? 0)));
    return rows;
  };
  const reader = {
    select: (_c, opts) => (opts?.head ? { ...reader, _count: true } : reader),
    maybeSingle: () => Promise.resolve({ data: sel()[0] ?? null, error: null, count: sel().length }),
    single: () => Promise.resolve({ data: sel()[0] ?? null, error: null }),
    insert: (v) => ({ select: () => ({ single: () => {
      const row = { id: "m-" + S.next++, created_at: new Date(Date.now() + S.next).toISOString(),
                    is_primary: false, published: false, sort_order: 0, review_status: null, ...v };
      const tErr = triggers(row, null);
      if (tErr) return Promise.resolve({ data: null, error: tErr });
      const trial = [...S.rows, row];
      if (violatesOnePrimary(trial)) return Promise.resolve({ data: null, error: UNIQUE_ERR });
      S.rows.push(row);
      return Promise.resolve({ data: row, error: null });
    } }) }),
    update: (patch) => {
      const w = { then: (res, rej) => {
        const hit = bag().filter((r) => matches(q, r));
        const trial = bag().map((r) => (hit.includes(r) ? { ...r, ...patch } : r));
        for (const r of trial) {
          const prev = bag().find((x) => x.id === r.id);
          const tErr = triggers(r, prev);
          if (tErr) return Promise.resolve({ data: null, error: tErr }).then(res, rej);
        }
        if (violatesOnePrimary(trial)) return Promise.resolve({ data: null, error: UNIQUE_ERR }).then(res, rej);
        for (const r of hit) Object.assign(r, patch);
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
    then: (res, rej) => Promise.resolve({ data: sel(), error: null, count: sel().length }).then(res, rej),
  };
  Object.assign(reader, filters(reader));
  return reader;
}
export const supabaseAdmin = {
  from,
  storage: { from: () => ({ remove: (p) => (S.removed.push(...p), Promise.resolve({ data: null, error: null })) }) },
};
/** vehicles.photos, as sync_vehicle_photos derives it. */
export function publishedPaths(vehicleId) {
  return S.rows
    .filter((r) => r.vehicle_id === vehicleId && r.published)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
    .map((r) => r.storage_path);
}
`);

execFileSync("npx", ["esbuild", "src/lib/vehicle-media.functions.ts",
  "--bundle", "--platform=node", "--format=esm", "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/client.server.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub/roles.server.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit.js`,
  `--alias:@/lib/experience.server=./${OUT}/stub/experience.server.js`,
  `--outfile=${OUT}/media.mjs`, "--log-level=warning"], { stdio: "inherit" });

const mod = await import(`../${OUT}/media.mjs`);
const S = (globalThis.__vphoto ??= {});
S.tier ??= "owner"; S.rows ??= []; S.vehicles ??= []; S.removed ??= []; S.entries ??= []; S.next ??= 1;

const reset = () => {
  S.rows.length = 0; S.vehicles.length = 0; S.removed.length = 0; S.entries.length = 0; S.next = 1;
  S.vehicles.push({ id: VEHICLE, unit_number: "RR-SYN", year: 2013, make: "Ford", model: "Fusion", photos: [] });
  S.vehicles.push({ id: OTHER, unit_number: "RR-SYN2", year: 2015, make: "Toyota", model: "Camry", photos: [] });
};
const add = (n, vehicleId = VEHICLE) => mod.registerVehicleMedia({
  data: { vehicleId, path: `${vehicleId}/photo-${n}.jpg`, fileName: `photo-${n}.jpg`,
          mimeType: "image/jpeg", sizeBytes: 1000 + n, caption: null },
  context: { userId: "staff-1" },
});
const patch = (id, values) => mod.updateVehicleMedia({ data: { id, ...values }, context: { userId: "staff-1" } });
const byPath = (n, vehicleId = VEHICLE) => S.rows.find((r) => r.storage_path === `${vehicleId}/photo-${n}.jpg`);

// ================================================================
console.log("A VEHICLE GETS ONE LEAD PHOTO, NOT SIX");
{
  reset();
  for (let i = 1; i <= 6; i++) ok((await add(i)).ok, `photo ${i} is stored`);
  const primaries = S.rows.filter((r) => r.is_primary);
  ok(primaries.length === 1,
     `exactly one photo is the lead image (found ${primaries.length} of ${S.rows.length})`);
  ok(primaries[0]?.storage_path.endsWith("photo-1.jpg"), "  and it is the first one uploaded");
  ok(S.rows.every((r) => !r.published), "none of them is on the website — a person chooses that");
}

console.log("\nEVERY PHOTO CAN GO ON THE WEBSITE, NOT JUST THE FIRST");
{
  reset();
  for (let i = 1; i <= 3; i++) await add(i);
  const r1 = await patch(byPath(1).id, { published: true });
  ok(r1.ok, "the first photo publishes");
  const r2 = await patch(byPath(2).id, { published: true });
  ok(r2.ok, `THE SECOND PHOTO ALSO PUBLISHES (${r2.ok ? "ok" : r2.error})`);
  const r3 = await patch(byPath(3).id, { published: true });
  ok(r3.ok, "  and the third");
  ok(!/duplicate key|constraint/i.test(`${r2.error ?? ""}${r3.error ?? ""}`),
     "no raw database error ever reaches the person");
  ok(S.rows.filter((r) => r.is_primary && r.published).length === 1,
     "exactly one published photo is the lead image");
}

console.log("\nTHE LEAD IMAGE LEADS THE PUBLIC ORDER");
{
  reset();
  for (let i = 1; i <= 3; i++) await add(i);
  await patch(byPath(2).id, { published: true });
  await patch(byPath(3).id, { published: true });
  await patch(byPath(3).id, { makePrimary: true });
  const { publishedPaths } = await import(`../${OUT}/stub/client.server.js`);
  const order = publishedPaths(VEHICLE);
  ok(order[0]?.endsWith("photo-3.jpg"), `the chosen lead image is first for the public (${order.join(", ")})`);
  ok(S.rows.filter((r) => r.is_primary).length === 1, "  and it is the only one flagged");
  ok(byPath(3).published === true, "  making a photo the lead also puts it on the site");
}

console.log("\nUNPUBLISHING THE LEAD DOES NOT STRAND THE VEHICLE");
{
  reset();
  for (let i = 1; i <= 2; i++) await add(i);
  await patch(byPath(1).id, { published: true });
  await patch(byPath(2).id, { published: true });
  const lead = S.rows.find((r) => r.is_primary && r.published);
  const r = await patch(lead.id, { published: false });
  ok(r.ok, "the lead image can be taken off the site");
  ok(lead.is_primary === false, "  and stops being the lead image");
  ok(S.rows.some((r) => r.published), "  while the other photo stays on the site");
}

console.log("\nPHOTOS ALREADY STORED THE WRONG WAY MUST STILL PUBLISH");
{
  // Exactly the live state on RR-005 and RR-006: every photo flagged as the
  // lead image, none published. The fix above stops NEW photos being stored
  // like this; these are the ones already on disk, and nothing may rewrite
  // them behind the operator's back.
  reset();
  for (let i = 1; i <= 6; i++) {
    S.rows.push({ id: `legacy-${i}`, vehicle_id: VEHICLE, kind: "original", provenance: "uploaded",
      storage_bucket: "vehicle-photos", storage_path: `${VEHICLE}/legacy-${i}.jpg`,
      is_primary: true, published: false, sort_order: i - 1, review_status: null,
      created_at: new Date(Date.now() + i).toISOString() });
  }
  ok(S.rows.filter((r) => r.is_primary).length === 6, "all six start flagged as the lead image");

  const r1 = await patch("legacy-1", { published: true });
  ok(r1.ok, "the first publishes");
  const r2 = await patch("legacy-2", { published: true });
  ok(r2.ok, `THE SECOND PUBLISHES DESPITE THE BAD FLAG (${r2.ok ? "ok" : r2.error})`);
  const r3 = await patch("legacy-3", { published: true });
  ok(r3.ok, "  and the third");
  ok(S.rows.filter((r) => r.is_primary && r.published).length === 1,
     "exactly one published photo leads");
  ok(S.rows.filter((r) => r.is_primary && !r.published).length === 3,
     "  and the still-unpublished rows are left exactly as they were found");
}

console.log("\nA SECOND VEHICLE IS UNAFFECTED");
{
  reset();
  await add(1); await add(1, OTHER);
  await patch(byPath(1).id, { published: true });
  const r = await patch(byPath(1, OTHER).id, { published: true });
  ok(r.ok, "each vehicle has its own lead image");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
