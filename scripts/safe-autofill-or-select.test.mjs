/**
 * Safe Autofill's conditional write must work against PostgREST as it really
 * behaves, and must never leave a vehicle field changed without a history row.
 *
 * PostgREST 12 (checked on 12.2.3) applies a PATCH's `or=` filter twice: once
 * to choose the rows to update, and again to the RETURNING rows, AFTER the
 * write. Seen on a local 12.2.3 against the replayed schema:
 *
 *   PATCH /vehicles?id=eq.<v>&or=(color.is.null,color.eq.)&select=id
 *     -> 400 {"code":"42703","message":"column vehicles.color does not exist"}
 *        (zero rows or not; nothing is written)
 *   PATCH /vehicles?id=eq.<v>&or=(color.is.null,color.eq.)&select=id,color
 *     -> 200 []  ... and color IS now "Blue": the write happened, but the new
 *        value no longer satisfies "is null or empty", so the row is filtered
 *        out of the response.
 *
 * The first shape is what shipped: every non-seats fill threw "Could not write
 * <field>." and paused autofill. The obvious fix (select the column) is the
 * second shape, which is worse: the caller reads [] as "someone else filled it
 * first", skips the history row, and the vehicle changes silently — the one
 * thing autofill promises never to do. Plain filters (is.null, then eq."")
 * are not re-applied and return the updated row.
 *
 * The fake (scripts/fake-supabase.src.mjs) models both behaviours, so this
 * file fails on the shipped code and on the select-the-column fix alike.
 *
 * Run: node scripts/safe-autofill-or-select.test.mjs  (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".autofill-or-build";
const VIN = "1HGCM82633A004352";           // synthetic, valid check digit
const VEHICLE = "aaaaaaaa-0000-4000-8000-000000000002";
const ITEM = "cccccccc-0000-4000-8000-000000000002";
const DOC = "dddddddd-0000-4000-8000-000000000002";
const PROPOSAL = "eeeeeeee-0000-4000-8000-000000000002";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/stub`, { recursive: true });
writeFileSync(`${OUT}/stub/supabase.js`, readFileSync("scripts/fake-supabase.src.mjs", "utf8"));
writeFileSync(`${OUT}/stub/audit.js`, `export const logAudit = async () => {};`);

execFileSync("npx", [
  "esbuild", "src/lib/safe-autofill.server.ts",
  "--bundle", "--platform=node", "--format=esm", `--outfile=${OUT}/autofill.mjs`,
  "--alias:@=./src",
  `--alias:@/lib/audit.server=./${OUT}/stub/audit.js`,
], { stdio: ["ignore", "ignore", "inherit"] });

const { runSafeAutofillForItem } = await import(`../${OUT}/autofill.mjs`);
const { supabaseAdmin: sb } = await import(`../${OUT}/stub/supabase.js`);
const S = globalThis.__fakeSb;

const FIELDS = ["trim", "body_type", "color", "fuel_type", "seats"];

/** One vehicle, one pending registration proposal carrying `fields`. */
function seed(vehicleOver, fields) {
  S.defaults = {};
  S.failInsert = null;
  S.tables = {
    app_settings: [{ key: "safe_autofill", value: { enabled: true, daily_cap: 50, paused_at: null, paused_reason: null } }],
    vehicles: [{ id: VEHICLE, vin: VIN, model: "Fusion", archived_at: null,
      trim: null, body_type: null, color: null, fuel_type: null, seats: null, ...vehicleOver }],
    fleet_import_items: [{ id: ITEM, batch_id: "bbbbbbbb-0000-4000-8000-000000000002", document_id: DOC,
      doc_class: "registration", analyzed_at: "2026-10-25T00:00:00Z" }],
    fleet_import_proposals: [{ id: PROPOSAL, item_id: ITEM, vin: VIN, page: 1, status: "pending",
      fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v, raw: v, confidence: "high" }])) }],
    vehicle_autofill_events: [], vehicle_field_provenance: [],
  };
  S.log = [];
}
const vehicle = () => S.tables.vehicles[0];
const events = () => S.tables.vehicle_autofill_events;
const settings = () => S.tables.app_settings[0].value;

/**
 * The guarantee, checked after every scenario: a field that differs from its
 * starting value has exactly one live history row saying so. A write that
 * returned nothing and was skipped fails here.
 */
function noSilentWrites(before, label) {
  for (const f of FIELDS) {
    if (vehicle()[f] === before[f]) continue;
    const ev = events().filter((e) => e.field === f && e.new_value === String(vehicle()[f]));
    ok(ev.length === 1, `${label}: ${f} changed to ${JSON.stringify(vehicle()[f])} and has a history row`);
  }
}

console.log("\na blank (null) colour is filled, and the fill is recorded");
seed({}, { color: "BLUE" });
let before = { ...vehicle() };
let r = await runSafeAutofillForItem(sb, ITEM);
ok(r.status === "done", `the run finishes cleanly (got ${r.status}${r.message ? `: ${r.message}` : ""})`);
ok(r.filled === 1, `  and reports one fill (got ${r.filled})`);
ok(vehicle().color === "Blue", "colour is now Blue");
ok(events().length === 1 && events()[0].field === "color", "  with one autofill history row");
ok(S.tables.vehicle_field_provenance.length === 1, "  and its provenance");
ok(!settings().paused_reason, "autofill is not paused");
noSilentWrites(before, "null colour");

console.log("\nan empty-string trim counts as blank and is filled too");
seed({ trim: "" }, { trim: "SE" });
before = { ...vehicle() };
r = await runSafeAutofillForItem(sb, ITEM);
ok(r.status === "done" && r.filled === 1, `one fill, no error (got ${r.status}/${r.filled}${r.message ? `: ${r.message}` : ""})`);
ok(vehicle().trim === "SE", "trim is now SE");
noSilentWrites(before, "empty trim");

console.log("\nevery text field the policy allows, in one document");
seed({}, { trim: "SE", body_type: "SEDAN", color: "BLUE", fuel_type: "GAS", seats: "5" });
before = { ...vehicle() };
r = await runSafeAutofillForItem(sb, ITEM);
ok(r.status === "done" && r.filled === 5, `five fills, no error (got ${r.status}/${r.filled}${r.message ? `: ${r.message}` : ""})`);
ok(events().length === 5, "  and five history rows");
noSilentWrites(before, "all fields");

console.log("\na value typed by a person after the read is never overwritten");
seed({}, { color: "BLUE" });
// Between autofill reading the vehicle and writing it, a person sets the colour.
const racing = {
  ...sb,
  from: (t) => {
    const q = sb.from(t);
    if (t !== "vehicles") return q;
    return { ...q, update: (p) => { vehicle().color = "Red"; return q.update(p); } };
  },
};
r = await runSafeAutofillForItem(racing, ITEM);
ok(vehicle().color === "Red", "the person's Red is kept");
ok(r.status === "done" && r.filled === 0 && r.skipped >= 1, `nothing filled, counted as skipped, no error (got ${r.status}/${r.filled}/${r.skipped})`);
ok(events().length === 0, "  and no history row claims a fill that did not happen");

console.log("\nif the history row cannot be written, the fill is reverted and autofill pauses");
seed({}, { color: "BLUE" });
S.failInsert = "vehicle_autofill_events";
r = await runSafeAutofillForItem(sb, ITEM);
ok(vehicle().color === null, "colour is back to blank");
ok(r.status === "error", "the run reports an error");
ok(/history/i.test(String(settings().paused_reason)), "  and autofill is paused with the reason");

console.log("\nthe fake really models PostgREST, so the passes above mean something");
seed({}, {});
let probe = await sb.from("vehicles").update({ color: "Blue" }).eq("id", VEHICLE).or("color.is.null,color.eq.").select("id");
ok(probe.error?.code === "42703" && vehicle().color === null, "or() not covered by select(): 42703 and nothing written (the shipped shape)");
probe = await sb.from("vehicles").update({ color: "Blue" }).eq("id", VEHICLE).or("color.is.null,color.eq.").select("id,color");
ok(!probe.error && probe.data.length === 0 && vehicle().color === "Blue", "or() covered by select(): written, yet [] comes back (the tempting fix)");

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
