/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   READING PHOTOS COSTS MONEY, SO THE OWNER'S LIMIT HAS TO HOLD —
 *   INCLUDING WHEN TWO PEOPLE PRESS READ AT THE SAME INSTANT.
 *
 * Everything else in this system that is "limited" is limited by counting
 * rows and then deciding. That is fine for Safe Autofill, whose cost is zero.
 * It is not fine here: two requests that both read "19 of 20 used" will both
 * proceed and the day ends at 21. So the counter moves by compare-and-swap on
 * the settings row, and the test that matters is the one that fires many
 * reservations concurrently and insists the total never exceeds the limit.
 *
 * A disabled or missing setting must refuse. An Owner alone may change it.
 * A duplicate must cost nothing. Work that never reaches the queue must give
 * its slot back.
 *
 * Real modules, fake Supabase, stubbed reader. No network, no paid call, no
 * real photo.
 *
 * Run: node scripts/photo-reading-cap.test.mjs  (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".photocap-build";
const VEHICLE = "aaaaaaaa-0000-4000-8000-000000000001";
const BATCH = "bbbbbbbb-0000-4000-8000-000000000001";
const VIN = "1HGCM82633A004352";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });
writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/audit.js`, `
const S = (globalThis.__fakeSb ??= {});
export const logAudit = async (actor, entry) => { (S.audits ??= []).push(entry); };
`);
writeFileSync(`${OUT}/stub/react-start.js`, `
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};
`);
writeFileSync(`${OUT}/stub/auth-middleware.js`, `export const requireSupabaseAuth = {};`);
writeFileSync(`${OUT}/stub/roles.server.js`, `
const S = (globalThis.__fakeSb ??= {});
S.tier ??= "owner";
export const requireStaff = async (u) => ({ userId: u, tier: S.tier, role: S.tier === "owner" ? "admin" : S.tier });
export const requireManager = async (u) => { if (S.tier === "coordinator") throw new Error("Forbidden"); return { userId: u, tier: S.tier, role: "admin" }; };
export const requireOwner = async (u) => { if (S.tier !== "owner") throw new Error("Forbidden"); return { userId: u, tier: S.tier, role: "admin" }; };
`);

execFileSync("npx", ["esbuild", "src/lib/vehicle-photo-analysis.functions.ts",
  "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/fn.mjs`, "--alias:@=./src",
  `--alias:@tanstack/react-start=./${OUT}/stub/react-start.js`,
  `--alias:@/integrations/supabase/auth-middleware=./${OUT}/stub/auth-middleware.js`,
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/supabase.js`,
  `--alias:@/lib/roles.server=./${OUT}/stub/roles.server.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit.js`,
  `--alias:@/lib/audit.server=./${OUT}/stub/audit.js`,
], { stdio: ["ignore", "ignore", "inherit"] });

const { readVehiclePhoto, getPhotoReadingStatus, savePhotoReadingSettings } = await import(`../${OUT}/fn.mjs`);
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });
const call = (fn, data) => fn({ data: fn._validate ? fn._validate(data) : data, context: { userId: "staff-1" } });
const today = new Date().toISOString().slice(0, 10);

/** `n` distinct photographs on one vehicle, and whatever settings row is asked for. */
function seed({ tier = "owner", settings = null, photos = 12 } = {}) {
  S.tier = tier;
  S.defaults = { fleet_import_proposals: { status: "pending" }, fleet_import_items: { status: "uploaded" } };
  S.tables = {
    app_settings: settings ? [{ key: "photo_reading", value: settings }] : [],
    vehicles: [{ id: VEHICLE, vin: VIN, unit_number: "T1", archived_at: null }],
    vehicle_media: Array.from({ length: photos }, (_, i) => ({
      id: `eeeeeeee-0000-4000-8000-00000000000${i.toString(16)}`, vehicle_id: VEHICLE, kind: "original",
      storage_bucket: "vehicle-photos", storage_path: `${VEHICLE}/shot-${i}.jpg`,
      file_name: `shot-${i}.jpg`, mime_type: "image/jpeg", size_bytes: 2048,
    })),
    fleet_import_batches: [{ id: BATCH, source_channel: "vehicle_photo", status: "uploading" }],
    fleet_import_items: [], fleet_inbox_jobs: [], documents: [], audit_log: [],
  };
  S.files = Object.fromEntries(S.tables.vehicle_media.map((m) => [`vehicle-photos/${m.storage_path}`, [0xff, 0xd8, 0xff, 0xe0]]));
  S.audits = [];
  // The roles stub is a top-level import, so it creates globalThis.__fakeSb
  // bare before this file's own initialiser runs. Everything the fake needs
  // is therefore set here, not assumed.
  S.log = [];
  S.failInsert = null;
}
const cfg = (over = {}) => ({
  enabled: true, daily_limit: 3, paused_reason: null, paused_at: null,
  usage_date: today, used_today: 0, updated_by: "owner-1", updated_at: new Date().toISOString(),
  version: 1, ...over,
});
const media = (i) => S.tables.vehicle_media[i].id;
const read = (i) => call(readVehiclePhoto, { batchId: BATCH, vehicleId: VEHICLE, mediaId: media(i), intendedClass: "condition_photo" });
const used = () => (S.tables.app_settings[0]?.value?.used_today ?? 0);
const jobs = () => S.tables.fleet_inbox_jobs.length;

console.log("\nwith no settings row at all, reading is off — it does not default to unlimited");
seed({ settings: null });
let r = await read(0);
ok(!r.ok && /switched off/i.test(r.error ?? ""), "the request is refused, and says where to turn it on");
ok(jobs() === 0, "  and nothing was queued");

console.log("\nswitched off by the Owner");
seed({ settings: cfg({ enabled: false }) });
r = await read(0);
ok(!r.ok && /switched off/i.test(r.error ?? ""), "refused");
ok(jobs() === 0 && used() === 0, "  nothing queued, nothing counted");

console.log("\npaused after a failure");
seed({ settings: cfg({ paused_reason: "AI credits exhausted" }) });
r = await read(0);
ok(!r.ok && /paused: AI credits exhausted/i.test(r.error ?? ""), "refused, quoting the reason");
ok(jobs() === 0, "  and nothing queued");

console.log("\na daily limit of zero is a limit, not an oversight");
seed({ settings: cfg({ daily_limit: 0 }) });
r = await read(0);
ok(!r.ok && /limit of zero/i.test(r.error ?? ""), "refused");
ok(jobs() === 0, "  and nothing queued");

console.log("\nwithin the limit, reading proceeds and the allowance falls");
seed({ settings: cfg({ daily_limit: 3 }) });
const first = await read(0);
ok(first.ok, "the first read is queued");
ok(first.remainingToday === 2, "  and reports two left");
ok(used() === 1 && jobs() === 1, "  one slot taken, one job queued");
await read(1); await read(2);
ok(used() === 3 && jobs() === 3, "three reads use three slots");
r = await read(3);
ok(!r.ok && /limit of 3/i.test(r.error ?? ""), "the fourth is refused by the limit");
ok(used() === 3 && jobs() === 3, "  and neither the count nor the queue moved");

console.log("\nTHE ONE THAT MATTERS: twelve readers that have all seen the same stale row");
// Single-threaded callers otherwise take turns, each seeing the previous
// write, and a compare-and-swap test would pass with the compare deleted.
// The gate holds every app_settings read open until all twelve have it, so
// they genuinely contend for the same slots.
seed({ settings: cfg({ daily_limit: 3 }) });
{
  let release;
  S.gateTable = "app_settings";
  S.gate = new Promise((r) => { release = r; });
  const inflight = Promise.all(Array.from({ length: 12 }, (_, i) => read(i)));
  await new Promise((r) => setTimeout(r, 120));   // let all twelve reach the read
  S.gate = null;                                   // later retries read fresh
  release();
  const contended = await inflight;
  const wonC = contended.filter((x) => x.ok).length;
  ok(wonC === 3, `exactly 3 of 12 contending readers were allowed (got ${wonC})`);
  ok(used() === 3, `  the counter says 3, not more (says ${used()})`);
  ok(jobs() === 3, `  and exactly 3 readings were queued (queued ${jobs()})`);
  S.gateTable = null;
}

console.log("\nand the same, unsynchronised");
seed({ settings: cfg({ daily_limit: 3 }) });
const racers = await Promise.all(Array.from({ length: 12 }, (_, i) => read(i)));
const won = racers.filter((x) => x.ok).length;
const lost = racers.filter((x) => !x.ok).length;
ok(won === 3, `exactly 3 of 12 concurrent requests were allowed (got ${won})`);
ok(lost === 9, `  and the other 9 were refused (got ${lost})`);
ok(used() === 3, `  the counter says 3, not more (says ${used()})`);
ok(jobs() === 3, `  and exactly 3 readings were queued (queued ${jobs()})`);
ok(new Set(racers.filter((x) => x.ok).map((x) => x.remainingToday)).size === 3,
  "  each winner got a distinct remaining count — no two shared a slot");

console.log("\nand again at a larger limit, to show it is not an artefact of 3");
seed({ settings: cfg({ daily_limit: 7 }) });
const more = await Promise.all(Array.from({ length: 12 }, (_, i) => read(i)));
ok(more.filter((x) => x.ok).length === 7, "exactly 7 of 12 allowed");
ok(used() === 7 && jobs() === 7, "  counter and queue agree at 7");

console.log("\nyesterday's usage does not count against today");
seed({ settings: cfg({ daily_limit: 2, usage_date: "2020-01-01", used_today: 99 }) });
r = await read(0);
ok(r.ok, "a stale usage date is treated as a fresh day");
ok(S.tables.app_settings[0].value.usage_date === today, "  and the row is re-dated to today");
ok(used() === 1, "  starting the count again at one");

console.log("\nreading the same photograph twice costs one slot, not two");
seed({ settings: cfg({ daily_limit: 5 }) });
await read(0);
ok(used() === 1, "the first read takes a slot");
const dup = await read(0);
ok(dup.ok && dup.duplicate === true, "  the second is recognised as already read");
ok(used() === 1, "  and takes no further slot");
ok(jobs() === 1, "  with no second reading queued");

console.log("\na refusal before any reading costs nothing");
seed({ settings: cfg({ daily_limit: 5 }) });
S.tables.vehicle_media[0].kind = "ai_enhanced";
r = await read(0);
ok(!r.ok, "a retouched copy is refused");
ok(used() === 0, "  and no slot was taken — the refusal happens before the reservation");

console.log("\nwork that never reaches the queue hands its slot back");
seed({ settings: cfg({ daily_limit: 5 }) });
S.failInsert = "fleet_inbox_jobs";
r = await read(0);
ok(!r.ok && /could not queue/i.test(r.error ?? ""), "a queue insert that fails is reported, not swallowed");
ok(used() === 0, "  and the reserved slot was released");
ok(S.tables.fleet_import_items[0]?.status === "failed", "  with the item marked failed so nothing reads it");
S.failInsert = null;

seed({ settings: cfg({ daily_limit: 5 }) });
S.failInsert = "fleet_import_items";
r = await read(0);
ok(!r.ok && /could not queue/i.test(r.error ?? ""), "an item insert that fails is reported too");
ok(used() === 0, "  and that reserved slot was released as well");
ok(jobs() === 0, "  with nothing left on the queue");
S.failInsert = null;

console.log("\nonly an Owner may change the settings");
seed({ settings: cfg() });
for (const tier of ["team", "coordinator"]) {
  S.tier = tier;
  let threw = null;
  try { await call(savePhotoReadingSettings, { enabled: true, dailyLimit: 999 }); } catch (e) { threw = e; }
  ok(!!threw && /forbidden/i.test(String(threw.message)), `${tier} is refused`);
  ok(S.tables.app_settings[0].value.daily_limit === 3, `  and the limit is unchanged`);
}
S.tier = "owner";
await call(savePhotoReadingSettings, { enabled: true, dailyLimit: 9 });
ok(S.tables.app_settings[0].value.daily_limit === 9, "control: an Owner CAN change it");
ok((S.audits ?? []).some((a) => a.action === "settings.photo_reading"), "  and the change is audited");

console.log("\nevery tier may SEE the state, so a Manager is told why the button is dead");
seed({ settings: cfg({ enabled: false }) });
for (const tier of ["owner", "team", "coordinator"]) {
  S.tier = tier;
  const st = await getPhotoReadingStatus({ context: { userId: "staff-1" } });
  ok(st.enabled === false && /switched off/i.test(st.refusal ?? ""), `${tier} sees the refusal reason`);
  ok(st.isOwner === (tier === "owner"), `  and is told whether they may change it`);
}

console.log("\na Manager may read photos when the Owner has allowed it");
seed({ tier: "team", settings: cfg({ daily_limit: 2 }) });
r = await read(0);
ok(r.ok, "the read is queued for a Manager");
ok(used() === 1, "  and counts against the same daily limit");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
