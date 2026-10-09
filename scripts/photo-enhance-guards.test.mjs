/**
 * THE RULES THIS FILE EXISTS FOR:
 *
 *   AN ORIGINAL PHOTOGRAPH IS NEVER TOUCHED.
 *   APPROVING A RETOUCHED IMAGE IS NOT PUBLISHING IT.
 *   AN UNAPPROVED RETOUCH CANNOT REACH THE WEBSITE.
 *   NOTHING HERE CAN COST MONEY.
 *
 * These are the promises the feature makes in its own comments, and until now
 * nothing checked any of them. They are also the ones where a mistake is
 * expensive rather than annoying: a retouched photo on a public listing is a
 * driver being shown a car that does not look like the car.
 *
 * This runs the real server functions against a fake Supabase that enforces
 * the same two triggers the database does — vehicle_media_enhanced_unpublished
 * and vehicle_media_enhanced_publish_guard — so a regression has to get past
 * the application AND the trigger to pass.
 *
 * No paid service is called; no model is downloaded; every fixture is
 * synthetic. No real photo or record is touched.
 *
 * Run: node scripts/photo-enhance-guards.test.mjs   (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const VEHICLE = "0a1b2c3d-0000-4000-8000-00000000000a";
const OUT = ".pguard-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });

writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => { const a = { middleware: () => a, inputValidator: (v) => (a._v = v, a), handler: (f) => Object.assign(f, { _v: a._v }) }; return a; };
`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub/roles.server.js`, `
const S = (globalThis.__pg ??= {});
S.tier ??= "owner";
export const requireStaff = async (u) => ({ userId: u, tier: S.tier, role: "admin" });
export const requireManager = async (u) => { if (S.tier === "coordinator") throw new Error("Forbidden"); return { userId: u, tier: S.tier, role: "admin" }; };
export const requireTier = async (u, t) => { if (t === "owner" && S.tier !== "owner") throw new Error("Forbidden"); return { userId: u, tier: S.tier, role: "admin" }; };
export const requireOwner = requireTier;
`);
writeFileSync(`${OUT}/stub/audit.js`, `
const S = (globalThis.__pg ??= {}); S.audit ??= [];
export const logAudit = async (a, e) => { S.audit.push({ tier: a.tier, ...e }); };
`);
writeFileSync(`${OUT}/stub/browser.js`, `
export const STUDIO_ENABLED = false;
export const ENHANCE_MODES = ["enhanced"];
`);
writeFileSync(`${OUT}/stub/client.server.js`, `
const S = (globalThis.__pg ??= {});
S.media ??= []; S.events ??= []; S.settings ??= {}; S.files ??= {}; S.removed ??= []; S.n ??= 1;

/** The two database triggers, honoured here so a regression must beat both. */
function guards(next) {
  if (next.kind === "ai_enhanced" && next.__inserting) { next.published = false; next.provenance = "ai_enhanced"; }
  if (next.kind === "ai_enhanced" && next.published && next.review_status !== "approved") {
    return { message: "A retouched photo must be approved before it can be published" };
  }
  return null;
}
const match = (q, r) => q.eq.every(([c, v]) => r[c] === v) && q.gte.every(([c, v]) => String(r[c]) >= v);
function table(name) {
  if (name === "vehicle_media") return S.media;
  if (name === "photo_enhance_events") return S.events;
  if (name === "photo_enhance_settings") return [S.settings];
  return [];
}
function from(name) {
  const q = { eq: [], gte: [], or: null };
  const bag = () => table(name);
  const f = (self) => ({
    eq: (c, v) => (q.eq.push([c, v]), self), neq: () => self, is: () => self,
    gte: (c, v) => (q.gte.push([c, v]), self), lte: () => self, in: () => self,
    or: (e) => ((q.or = e), self), order: () => self, limit: () => self,
  });
  const sel = () => bag().filter((r) => match(q, r));
  const api = {
    select: () => api,
    maybeSingle: () => Promise.resolve({ data: sel()[0] ?? null, error: null, count: sel().length }),
    single: () => Promise.resolve({ data: sel()[0] ?? null, error: null }),
    insert: (v) => ({ select: () => ({ single: () => {
      const row = { id: name.slice(0, 2) + "-" + S.n++, created_at: new Date().toISOString(), published: false, review_status: null, ...v, __inserting: true };
      const e = guards(row);
      delete row.__inserting;
      if (e) return Promise.resolve({ data: null, error: e });
      bag().push(row);
      return Promise.resolve({ data: row, error: null });
    } }) }),
    update: (patch) => { const w = { then: (res, rej) => {
      const hit = sel();
      for (const r of hit) { const e = guards({ ...r, ...patch }); if (e) return Promise.resolve({ data: null, error: e }).then(res, rej); }
      for (const r of hit) Object.assign(r, patch);
      return Promise.resolve({ data: null, error: null }).then(res, rej);
    } }; Object.assign(w, f(w)); return w; },
    delete: () => { const w = { then: (res, rej) => {
      const b = bag(); for (let i = b.length - 1; i >= 0; i--) if (match(q, b[i])) b.splice(i, 1);
      return Promise.resolve({ data: null, error: null }).then(res, rej);
    } }; Object.assign(w, f(w)); return w; },
    then: (res, rej) => Promise.resolve({ data: sel(), error: null, count: sel().length }).then(res, rej),
  };
  Object.assign(api, f(api));
  return api;
}
export const supabaseAdmin = {
  from,
  storage: { from: () => ({
    remove: (p) => (S.removed.push(...p), p.forEach((x) => delete S.files[x]), Promise.resolve({ data: null, error: null })),
    download: (p) => Promise.resolve(S.files[p] === undefined
      ? { data: null, error: { message: "not found" } }
      : { data: { arrayBuffer: async () => S.files[p].buffer.slice(S.files[p].byteOffset, S.files[p].byteOffset + S.files[p].byteLength) }, error: null }),
  }) },
};
`);

execFileSync("npx", ["esbuild", "src/lib/photo-enhance.functions.ts",
  "--bundle", "--platform=node", "--format=esm", "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/client.server.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub/roles.server.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit.js`,
  `--alias:@/lib/photo-enhance.browser=./${OUT}/stub/browser.js`,
  `--outfile=${OUT}/pe.mjs`, "--log-level=warning"], { stdio: "inherit" });

const mod = await import(`../${OUT}/pe.mjs`);
const S = (globalThis.__pg ??= {});
S.tier ??= "owner"; S.media ??= []; S.events ??= []; S.settings ??= {}; S.files ??= {}; S.removed ??= []; S.audit ??= []; S.n ??= 1;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const NOT_JPEG = new TextEncoder().encode("%PDF-1.4 this is not a photograph");

function reset() {
  S.media.length = 0; S.events.length = 0; S.removed.length = 0; S.audit.length = 0; S.n = 1;
  for (const k of Object.keys(S.files)) delete S.files[k];
  Object.assign(S.settings, { id: true, enabled: true, daily_limit: 20, monthly_paid_cap_cents: 1000 });
  S.tier = "owner";
  S.media.push({ id: "orig-1", vehicle_id: VEHICLE, kind: "original", provenance: "uploaded",
    storage_bucket: "vehicle-photos", storage_path: `${VEHICLE}/original-1.jpg`,
    is_primary: true, published: true, sort_order: 0, review_status: null, size_bytes: 5000,
    created_at: new Date().toISOString() });
}
const as = (t) => { S.tier = t; };
const ctx = { userId: "staff-1" };
async function makeEnhanced({ bytes = JPEG, sizeClaim = 99999 } = {}) {
  const st = await mod.startPhotoEnhance({ data: { mediaId: "orig-1", mode: "enhanced" }, context: ctx });
  if (!st.ok) return { startError: st.error };
  const path = `${VEHICLE}/enhanced-${S.n}-x.jpg`;
  S.files[path] = bytes;
  const done = await mod.completePhotoEnhance({ data: { eventId: st.eventId, path, sizeBytes: sizeClaim, processingMs: 500, flags: [] }, context: ctx });
  return { ...done, path, eventId: st.eventId };
}

// ================================================================
console.log("THE ORIGINAL PHOTOGRAPH IS NEVER TOUCHED");
{
  reset();
  const before = JSON.stringify(S.media.find((m) => m.id === "orig-1"));
  const r = await makeEnhanced();
  ok(r.ok, "a retouched version is created");
  ok(JSON.stringify(S.media.find((m) => m.id === "orig-1")) === before,
     "the original row is byte-for-byte unchanged");
  ok(S.files[`${VEHICLE}/original-1.jpg`] === undefined && !S.removed.includes(`${VEHICLE}/original-1.jpg`),
     "  and its stored file is never removed");
  const copy = S.media.find((m) => m.kind === "ai_enhanced");
  ok(copy.derived_from_id === "orig-1", "the copy records which original it came from");
  ok(copy.storage_path !== "orig-1", "  and is a separate file");
}

console.log("\nA RETOUCHED IMAGE ARRIVES UNPUBLISHED AND PENDING");
{
  reset();
  await makeEnhanced();
  const e = S.media.find((m) => m.kind === "ai_enhanced");
  ok(e.published === false, "it is not on the website");
  ok(e.review_status === "pending", "it is waiting for review");
  ok(e.provenance === "ai_enhanced", "it is labelled as retouched");
  ok(e.is_primary === false, "it is not the lead image");
}

console.log("\nAPPROVING IS NOT PUBLISHING");
{
  reset();
  await makeEnhanced();
  const e = S.media.find((m) => m.kind === "ai_enhanced");
  const r = await mod.reviewPhotoEnhance({ data: { mediaId: e.id, decision: "approve" }, context: ctx });
  ok(r.ok, "it can be approved");
  ok(e.review_status === "approved", "  and is recorded as approved");
  ok(e.published === false, "APPROVAL DOES NOT PUT IT ON THE WEBSITE");
  ok(S.audit.some((a) => a.action === "vehicle.photo.enhanced_approved"), "  the decision is audited");
}

console.log("\nAN UNAPPROVED RETOUCH CANNOT REACH THE WEBSITE");
{
  reset();
  await makeEnhanced();
  const e = S.media.find((m) => m.kind === "ai_enhanced");
  // Straight at the table, the way a bug or a stray script would come.
  const { supabaseAdmin } = await import(`../${OUT}/stub/client.server.js`);
  const { error } = await supabaseAdmin.from("vehicle_media").update({ published: true }).eq("id", e.id);
  ok(!!error, `the database refuses it (${error?.message ?? "NO ERROR — the guard did not fire"})`);
  ok(e.published === false, "  and it stays off the website");
}
{
  reset();
  await makeEnhanced();
  const e = S.media.find((m) => m.kind === "ai_enhanced");
  await mod.reviewPhotoEnhance({ data: { mediaId: e.id, decision: "approve" }, context: ctx });
  const { supabaseAdmin } = await import(`../${OUT}/stub/client.server.js`);
  const { error } = await supabaseAdmin.from("vehicle_media").update({ published: true }).eq("id", e.id);
  ok(!error && e.published === true, "once approved, it may be published");
}

console.log("\nREJECTING REMOVES THE DERIVATIVE, NOT THE ORIGINAL");
{
  reset();
  await makeEnhanced();
  const e = S.media.find((m) => m.kind === "ai_enhanced");
  const r = await mod.reviewPhotoEnhance({ data: { mediaId: e.id, decision: "reject" }, context: ctx });
  ok(r.ok, "it can be rejected");
  ok(!S.media.some((m) => m.kind === "ai_enhanced"), "  the retouched row is gone");
  ok(S.removed.includes(e.storage_path), "  and so is its file");
  ok(S.media.some((m) => m.id === "orig-1"), "THE ORIGINAL SURVIVES");
}
{
  reset();
  const r = await mod.reviewPhotoEnhance({ data: { mediaId: "orig-1", decision: "reject" }, context: ctx });
  ok(!r.ok, "an ORIGINAL can never be reviewed or deleted through this path");
  ok(S.media.some((m) => m.id === "orig-1"), "  it is still there");
}

console.log("\nM3 — THE RESULT IS VERIFIED, NOT TAKEN ON TRUST");
{
  reset();
  const st = await mod.startPhotoEnhance({ data: { mediaId: "orig-1", mode: "enhanced" }, context: ctx });
  const path = `${VEHICLE}/enhanced-missing.jpg`; // nothing uploaded here
  const r = await mod.completePhotoEnhance({ data: { eventId: st.eventId, path, sizeBytes: 1234, processingMs: 10, flags: [] }, context: ctx });
  ok(!r.ok, `a path with nothing behind it is refused (${r.error})`);
  ok(!S.media.some((m) => m.kind === "ai_enhanced"), "  no row points at a file that does not exist");
  ok(S.events.find((e) => e.id === st.eventId)?.status === "failed", "  and the attempt is recorded as failed");
}
{
  reset();
  const r = await makeEnhanced({ bytes: NOT_JPEG });
  ok(!r.ok, `a file that is not a photograph is refused (${r.error})`);
  ok(!S.media.some((m) => m.kind === "ai_enhanced"), "  nothing is registered");
  ok(S.removed.includes(r.path), "  and the file is removed from the bucket");
}
{
  reset();
  await makeEnhanced({ sizeClaim: 99999 });
  const e = S.media.find((m) => m.kind === "ai_enhanced");
  ok(e.size_bytes === JPEG.byteLength,
     `the stored size is measured (${e.size_bytes}), not the ${99999} the browser claimed`);
}

console.log("\nROLES ARE ENFORCED ON THE SERVER");
{
  reset(); as("coordinator");
  let threw = false;
  try { await mod.startPhotoEnhance({ data: { mediaId: "orig-1", mode: "enhanced" }, context: ctx }); } catch { threw = true; }
  ok(threw, "a Coordinator cannot start an enhancement");
  threw = false;
  try { await mod.reviewPhotoEnhance({ data: { mediaId: "x", decision: "approve" }, context: ctx }); } catch { threw = true; }
  ok(threw, "  nor review one");
  as("manager"); threw = false;
  try { await mod.savePhotoEnhanceSettings({ data: { enabled: false, dailyLimit: 5 }, context: ctx }); } catch { threw = true; }
  ok(threw, "a Manager cannot change the settings");
  as("owner");
  const r = await mod.savePhotoEnhanceSettings({ data: { enabled: false, dailyLimit: 5 }, context: ctx });
  ok(r.ok && S.settings.enabled === false, "the Owner can");
}

console.log("\nTHE SWITCH AND THE DAILY LIMIT ACTUALLY BIND");
{
  reset(); S.settings.enabled = false;
  const r = await mod.startPhotoEnhance({ data: { mediaId: "orig-1", mode: "enhanced" }, context: ctx });
  ok(!r.ok && /switched off/i.test(r.error), `switched off means refused (${r.error})`);
}
{
  reset(); S.settings.daily_limit = 1;
  await makeEnhanced();
  const r = await mod.startPhotoEnhance({ data: { mediaId: "orig-1", mode: "enhanced" }, context: ctx });
  ok(!r.ok && /limit/i.test(r.error), `the daily limit binds (${r.error})`);
}
{
  reset();
  const r = await mod.startPhotoEnhance({ data: { mediaId: "orig-1", mode: "studio" }, context: ctx });
  ok(!r.ok && /not available/i.test(r.error), "M1 — Studio is refused by the server while the one switch is off");
}
{
  reset();
  const e = S.media.find((m) => m.id === "orig-1");
  e.kind = "ai_enhanced"; e.review_status = "approved";
  const r = await mod.startPhotoEnhance({ data: { mediaId: "orig-1", mode: "enhanced" }, context: ctx });
  ok(!r.ok && /original/i.test(r.error), "only an original may be enhanced — never a retouch of a retouch");
}

console.log("\nM5 — NOTHING HERE CAN COST MONEY");
{
  reset();
  await makeEnhanced();
  ok(S.events.every((e) => (e.cost_cents ?? 0) === 0), "every event is recorded at zero cost");
  const src = readFileSync("src/lib/photo-enhance.functions.ts", "utf8");
  ok(!/monthlyPaidCapCents/.test(src), "the paid cap is no longer an input — it could never bind");
  // Strip JSX comments before matching: the note explaining what was removed
  // names the old control, and matching it would assert against my own comment.
  // Collapse whitespace too — JSX wraps prose across lines.
  const panel = readFileSync("src/components/admin/PhotoEnhancePanel.tsx", "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\s+/g, " ");
  ok(!/Monthly Paid Processing Cap/.test(panel), "  and no longer offered as a control");
  ok(/no paid provider is connected/i.test(panel), "  the screen says plainly that processing is free");
  ok(/cannot incur a charge|nothing here can incur a charge/i.test(panel), "  and that nothing can be charged");
  const adapter = readFileSync("src/lib/vehicle-enhance.server.ts", "utf8");
  ok(!/api_key|apiKey|fetch\(/.test(adapter), "no provider is wired into the adapter");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
