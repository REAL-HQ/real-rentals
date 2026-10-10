/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   A STAFF-FACING UPLOAD NEVER CHANGES A VEHICLE BY ITSELF.
 *
 * Fleet Inbox may run Safe Autofill. Uploads made FROM a vehicle — the
 * Documents tab (source_channel 'vehicle_profile') and now the Photos tab
 * ('vehicle_photo') — may not: every field on those goes through explicit
 * staff approval in Vehicle Suggestions.
 *
 * This was written to settle an observed anomaly, not to decorate a fix.
 * Production holds one vehicle_autofill_events row: Safe Autofill wrote
 * colour "Blue" onto RR-004 at 2026-10-09 13:07:52 from proposal
 * 57a0d1fa… — whose batch is source_channel 'vehicle_profile'. The guard
 * that should have stopped it was committed in f1144e5 at 13:03:47, four
 * minutes earlier, and is present in 814c9b4, the commit the preview was
 * building from. So either the running build was older than it looked, or
 * the guard has a hole.
 *
 * The only honest way to tell is to run the real analyzer. This bundles
 * fleet-inbox-core.server.ts and calls the real analyzeItemCore against a
 * fake Supabase and a stubbed reader — no network, no paid call, no real
 * photo, synthetic VINs that exist in no fleet.
 *
 * Scenario 3 is the control: on 'fleet_inbox' the write MUST happen. Without
 * it, a test that asserts "nothing was written" passes just as well when the
 * analyzer never ran at all.
 *
 * Run: node scripts/safe-autofill-channel.test.mjs  (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".autofill-build";
const VIN = "1HGCM82633A004352";           // synthetic, valid check digit
const VEHICLE = "aaaaaaaa-0000-4000-8000-000000000001";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });

writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/audit.js`, `export const logAudit = async () => {};`);
// The reader is stubbed: the point of this test is the channel rule, and a
// real call would cost money and need a real document.
writeFileSync(`${OUT}/stub/reader.js`, `
const S = (globalThis.__fakeSb ??= {});
export const READER_MAX_BYTES = 20 * 1024 * 1024;
export async function readDocument() {
  S.readerCalls = (S.readerCalls ?? 0) + 1;
  if (S.readerFails) return { ok: false, error: "The document reader returned an error (500).", status: 500 };
  return { ok: true, text: JSON.stringify(S.readerPayload) };
}
export function parseModelJson(t) { return JSON.parse(t); }
`);

execFileSync("npx", [
  "esbuild", "src/lib/fleet-inbox-core.server.ts",
  "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/core.mjs`,
  "--alias:@=./src",
  `--alias:@/integrations/supabase/client.server=./${OUT}/stub/supabase.js`,
  `--alias:@/lib/document-reader.server=./${OUT}/stub/reader.js`,
  `--alias:@/lib/audit.server=./${OUT}/stub/audit.js`,
  `--alias:@/lib/audit=./${OUT}/stub/audit.js`,
], { stdio: ["ignore", "ignore", "inherit"] });

const { analyzeItemCore } = await import(`../${OUT}/core.mjs`);
// The module under test reaches the client through `await import(...)`, so the
// stub has not been evaluated yet and has not created the shared state. Create
// it here; the stub's `??=` then adopts this object rather than replacing it.
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [] });

/** A clean world holding one blank vehicle and one unanalyzed registration card. */
function seed(sourceChannel) {
  // Postgres column defaults the inserts rely on.
  S.defaults = { fleet_import_proposals: { status: "pending" }, fleet_import_items: { status: "uploaded" } };
  S.tables = {
    app_settings: [{ key: "safe_autofill", value: { enabled: true, daily_cap: 50, paused_at: null, paused_reason: null } }],
    vehicles: [{ id: VEHICLE, vin: VIN, unit_number: "TEST-1", year: 2013, make: "Ford", model: "Fusion",
      color: null, body_type: null, trim: null, fuel_type: null, seats: null,
      license_plate: null, plate_state: null, title_number: null, registration_number: null,
      registration_state: null, registration_expires_on: null, current_odometer: null, archived_at: null }],
    vehicle_titles: [], vehicle_field_provenance: [], vehicle_autofill_events: [],
    fleet_import_batches: [{ id: "bbbbbbbb-0000-4000-8000-000000000001", source_channel: sourceChannel, status: "processing" }],
    fleet_import_items: [{ id: "cccccccc-0000-4000-8000-000000000001", batch_id: "bbbbbbbb-0000-4000-8000-000000000001",
      document_id: "dddddddd-0000-4000-8000-000000000001", status: "uploaded", doc_class: "registration", attempts: 0, file_name: "synthetic-reg.jpg" }],
    fleet_import_proposals: [], fleet_import_finance_facts: [], fleet_service_transactions: [], documents: [
      { id: "dddddddd-0000-4000-8000-000000000001", storage_bucket: "vehicle-docs", storage_path: "inbox/synthetic-reg.jpg", mime_type: "image/jpeg" },
    ],
    audit_log: [],
  };
  S.files = { "vehicle-docs/inbox/synthetic-reg.jpg": [0xff, 0xd8, 0xff, 0xe0] };
  S.log = [];
  S.readerCalls = 0;
  S.readerFails = false;
  S.readerPayload = {
    documentClass: "registration", classConfidence: "high", pageCount: 1,
    shared: {},
    vehicles: [{ page: 1, fields: {
      vin: { value: VIN, raw: VIN, confidence: "high" },
      color: { value: "BLU", raw: "BLU", confidence: "high" },
      license_plate: { value: "ZZZ999", raw: "ZZZ999", confidence: "high" },
      registration_expires_on: { value: "2027-06-30", raw: "06/30/2027", confidence: "high" },
    } }],
    warnings: [],
  };
}
const vehicle = () => S.tables.vehicles[0];
const events = () => S.tables.vehicle_autofill_events;
const ITEM = "cccccccc-0000-4000-8000-000000000001";

console.log("\nan upload from the vehicle's own Documents tab never writes by itself");
seed("vehicle_profile");
let r = await analyzeItemCore(ITEM);
ok(r.ok, "the analysis itself succeeds");
ok(S.readerCalls === 1, "  and the document was read exactly once");
ok(S.tables.fleet_import_proposals.length === 1, "  and a proposal is waiting for review");
ok(vehicle().color === null, "colour is still blank — no silent write");
ok(events().length === 0, "  and no autofill history was recorded, because nothing was filled");

console.log("\nthe same rule covers photos read from the Photos tab");
seed("vehicle_photo");
r = await analyzeItemCore(ITEM);
ok(r.ok, "the analysis succeeds");
ok(vehicle().color === null, "colour is still blank");
ok(events().length === 0, "  and nothing was autofilled");

console.log("\ncontrol: Fleet Inbox still autofills, so the assertions above mean something");
seed("fleet_inbox");
r = await analyzeItemCore(ITEM);
ok(r.ok, "the analysis succeeds");
ok(vehicle().color === "Blue", "colour WAS filled from the document — the test can see a write");
ok(events().length === 1, "  and it is recorded in autofill history");

console.log("\nwhatever the channel, the fields a person must confirm are never written");
for (const channel of ["vehicle_profile", "vehicle_photo", "fleet_inbox"]) {
  seed(channel);
  await analyzeItemCore(ITEM);
  ok(vehicle().license_plate === null, `${channel}: the plate still needs a person`);
  ok(vehicle().registration_expires_on === null, `${channel}: so does the registration expiry`);
}

console.log("\na batch whose channel was never recorded is treated as Fleet Inbox, not as a free pass");
seed(null);
await analyzeItemCore(ITEM);
ok(vehicle().color === "Blue", "an unlabelled batch behaves like Fleet Inbox (the documented default)");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
