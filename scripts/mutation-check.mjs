/**
 * Does each guard actually have a test that fails without it?
 *
 * A green suite proves nothing on its own. This repository has produced
 * several assertions that passed because a filename matched a dropdown
 * option, because a regex found the test's own comment, or because a refusal
 * had simply found nothing to refuse. The only cure is to break the code on
 * purpose and insist the suite notices.
 *
 * For each entry below: edit one line out of the real source, run the suite
 * that claims to cover it, restore the file, and require that the run went
 * red. Any guard whose suite stays green is reported as a BLOCKER — the guard
 * may well work, but nothing is watching it.
 *
 * It edits tracked files in place and always restores them, so run it on a
 * clean tree and check `git status` afterwards if a run is interrupted.
 *
 * Run: node scripts/mutation-check.mjs   (npm run test:mutation)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, renameSync, existsSync } from "node:fs";

const RULES = "src/lib/fleet-inbox.ts";
const CORE = "src/lib/fleet-inbox-core.server.ts";
const INBOX = "src/lib/fleet-inbox.functions.ts";
const DOORWAY = "src/lib/vehicle-photo-analysis.functions.ts";
const PHOTOS = "src/components/admin/VehiclePhotos.tsx";
const PANEL = "src/components/admin/VehicleSuggestions.tsx";
const CAP = "src/lib/photo-reading.server.ts";
const RULES2 = "src/lib/photo-reading.ts";
const READY = "src/lib/vehicle-readiness.ts";
const INSPFN = "src/lib/inspections.functions.ts";
const INSPUI = "src/components/admin/InspectionsPanel.tsx";
const PROFILE = "src/components/admin/VehicleProfile.tsx";
const ADMIN = "src/routes/admin.tsx";
const VEH = "src/lib/vehicles.functions.ts";
const EDITOR = "src/components/admin/AddVehicleDialog.tsx";

const SERVER = "scripts/vehicle-photo-analysis.test.mjs";
const CHANNEL = "scripts/safe-autofill-channel.test.mjs";
const UI = "scripts/vehicle-photo-analysis-ui.test.mjs";
const CAPTEST = "scripts/photo-reading-cap.test.mjs";
const E2E = "scripts/vehicle-photo-read-e2e.test.mjs";
const PLATE_E2E = "scripts/vehicle-plate-editing-e2e.test.mjs";
const READYTEST = "scripts/vehicle-readiness-phase1.test.mjs";
const PLATETEST = "scripts/vehicle-plate-editing.test.mjs";

/** [what it protects, file, exact line to remove or change, replacement, suite] */
const MUTATIONS = [
  ["a photo never yields registration, insurance, title or finance fields", RULES,
    "    if (photo && PHOTO_NEVER_FIELDS.has(field)) continue;", "", SERVER],
  ["a photo never outranks the registration card", RULES,
    "  license_plate: 35, plate_state: 35,", "  license_plate: 100, plate_state: 100,", SERVER],
  ["no photo-derived value is ever 'safe'", INBOX,
    "            && !isPhotoClass(it.doc_class),", "            ,", SERVER],
  ["a photo files no finance facts", CORE,
    "    const fin = isPhotoClass(docClass) ? [] : Object.entries(e.fields).filter(([k]) => isFinanceField(k));",
    "    const fin = Object.entries(e.fields).filter(([k]) => isFinanceField(k));", SERVER],
  ["the same photograph is never read twice", DOORWAY,
    "      if (priorItem) return { ok: true, mediaId: data.mediaId, itemId: priorItem.id as string, duplicate: true };",
    "      if (!priorItem) return { ok: false, mediaId: data.mediaId };", SERVER],
  ["only original photographs are read", DOORWAY,
    '    if (media.kind !== "original") {', "    if (false) {", SERVER],
  ["a photo cannot be filed as another vehicle's", DOORWAY,
    "    if (media.vehicle_id !== data.vehicleId) {", "    if (false) {", SERVER],
  ["the Photos tab is excluded from Safe Autofill", CORE,
    "  if (!isStaffReviewChannel(srcBatch?.source_channel)) await",
    '  if (srcBatch?.source_channel !== "vehicle_profile") await', CHANNEL],
  ["approving a field reloads the vehicle profile", PHOTOS,
    "                          window.dispatchEvent(new Event(\"vehicle-profile-refresh\"));\n                        }\n                      }}",
    "                        }\n                      }}", UI],
  ["an apply that wrote nothing does not claim a refresh", PHOTOS,
    "                        if (written > 0) {", "                        if (true) {", UI],
  ["only originals can be chosen for reading", PHOTOS,
    '              {picking && m.kind === "original" && (', "              {picking && (", UI],
  ["two simultaneous reads cannot both take the last slot", CAP,
    '      .eq("key", PHOTO_READING_KEY).eq("value->>version", String(current.version)).select("key");\n    // Exactly one writer sees rows come back',
    '      .eq("key", PHOTO_READING_KEY).select("key");\n    // Exactly one writer sees rows come back', CAPTEST],
  ["reading is off until an Owner turns it on", RULES2,
    '  if (!s.enabled) return "Photo Reading is switched off. An Owner can turn it on in Settings → Photo Reading.";',
    "", CAPTEST],
  ["the daily limit refuses the read that would exceed it", RULES2,
    "  if (remainingOn(s, day) <= 0) return `Today's limit of ${s.dailyLimit} photo${s.dailyLimit === 1 ? \"\" : \"s\"} has been reached. It resets at midnight UTC.`;",
    "", CAPTEST],
  ["a reserved slot is released when the item insert fails", DOORWAY,
    "    if (!item) {\n      await releasePhotoRead(sb, slot.day);",
    "    if (!item) {", CAPTEST],
  ["a reserved slot is released when the queue insert fails", DOORWAY,
    "      await sb.from(\"fleet_import_items\").update({ status: \"failed\", error: \"Could not queue the reading.\" }).eq(\"id\", item.id);\n      await releasePhotoRead(sb, slot.day);",
    "      await sb.from(\"fleet_import_items\").update({ status: \"failed\", error: \"Could not queue the reading.\" }).eq(\"id\", item.id);", CAPTEST],
  ["an inspection cannot be started against a vehicle that is not there", INSPFN,
    '    if (!vehicle) throw new Error("That vehicle no longer exists.");', "", READYTEST],
  ["an archived vehicle cannot be inspected", INSPFN,
    '    if (vehicle.archived_at) throw new Error("That vehicle is archived — restore it before inspecting it.");', "", READYTEST],
  ["the inspection form prefers the vehicle it was sent", INSPUI,
    "useState(initialVehicleId ?? vehicles[0]?.id ?? \"\")", 'useState(vehicles[0]?.id ?? "")', READYTEST],
  ["a readiness Fix carries the vehicle id", PROFILE,
    "search: { tab: f.tab, id: v.id } as never", "search: { tab: f.tab } as never", READYTEST],
  ["the router lets the inspections tab keep the vehicle id", ADMIN,
    '  id: ["drivers", "vehicles", "inspections"],', '  id: ["drivers", "vehicles"],', READYTEST],
  ["a title scan counts as a title on file", READY,
    "  if (t) return t.documentOnFile || t.metadataRecorded;", "  if (t) return t.metadataRecorded;", READYTEST],
  ["a missing registration expiry still blocks (no quiet downgrade)", READY,
    'checks.push(expiryCheck("registration", "Registration", v.registration_expires_on ?? null, slots.has("registration"), today, { kind: "edit", section: "dmv" }, "not_ready", "Open Registration"));',
    'checks.push(expiryCheck("registration", "Registration", v.registration_expires_on ?? null, slots.has("registration"), today, { kind: "edit", section: "dmv" }, "attention", "Open Registration"));', READYTEST],
  ["a missing insurance expiry still blocks (no quiet downgrade)", READY,
    'checks.push(expiryCheck("insurance", "Insurance", v.insurance_expires_on ?? null, slots.has("insurance_card"), today, { kind: "edit", section: "insurance" }, "not_ready", "Open Insurance"));',
    'checks.push(expiryCheck("insurance", "Insurance", v.insurance_expires_on ?? null, slots.has("insurance_card"), today, { kind: "edit", section: "insurance" }, "attention", "Open Insurance"));', READYTEST],
  ["every check carries a category", READY,
    '{ key: "safety", label: "Safety Issues", category: "operational", status: "ready"',
    '{ key: "safety", label: "Safety Issues", status: "ready"', READYTEST],
  ["the drawer that shows the plate can edit it", VEH,
    '    "license_plate",\n    "plate_state",\n    "seats",', '    "seats",', PLATETEST],
  ["a plate is stored upper-cased, so the unique index agrees with it", VEH,
    'const UPPERCASE_FIELDS = new Set(["vin", "license_plate", "plate_state", "registration_state"]);',
    'const UPPERCASE_FIELDS = new Set(["vin", "registration_state"]);', PLATETEST],
  ["what is never a plate is refused", VEH,
    "      const problem = plateProblem(nextPlate);\n      if (problem) return { ok: false, error: problem, field: \"license_plate\" };",
    "", PLATETEST],
  ["a plate state is one of the states", VEH,
    "      if (!isUsStateCode(nextPlateState))", "      if (false)", PLATETEST],
  ["two cars cannot wear one plate", VEH,
    '      ["license_plate", "license_plate", "plate"],\n', "", PLATETEST],
  ["Add Vehicle refuses what the drawer would refuse", VEH,
    "        const problem = plateProblem(data.license_plate.trim().toUpperCase());\n        if (problem) return { ok: false, error: problem, field: \"license_plate\" };",
    "", PLATETEST],
  ["editing a vehicle is Manager-only", VEH,
    "    const actor = await requireManager(context.userId);\n    const { supabaseAdmin } = await import(\"@/integrations/supabase/client.server\");\n    return applySection(supabaseAdmin, actor, {",
    "    const actor = await requireStaff(context.userId);\n    const { supabaseAdmin } = await import(\"@/integrations/supabase/client.server\");\n    return applySection(supabaseAdmin, actor, {",
    PLATETEST],
  ["the plate state dropdown offers the states", PROFILE,
    "            options={usStateOptions()}", '            options={[{ value: "", label: "—" }]}', PLATETEST],
  ["Edit Details points at the drawer that owns the expiry dates", PROFILE,
    'onOpenSection("dmv");', 'onOpenSection("identity");', PLATETEST],
  ["a handed-over drawer starts from the saved record", PROFILE,
    "          key={editing}\n", "", PLATETEST],
  ["an extracted plate is never swept in by Approve Safe Fields", INBOX,
    '            && !["license_plate", "plate_state", "current_odometer", "vin"].includes(c.field)',
    "            && true", PLATETEST],
  ["Add Vehicle chooses a state rather than typing one", EDITOR,
    "              {usStateOptions().map((o) => (", "              {[{ value: \"\", label: \"—\" }].map((o) => (", PLATETEST],
  ["the evidence thumbnail uses the staff storage download", PANEL,
    "    void loadStaffPhoto(path).then((u) => { if (live) setUrl(u); });",
    "    void Promise.resolve(null).then((u) => { if (live) setUrl(u); });", UI],
];

// Browser-level safeguards. These need `npm run dev` running and take about
// a minute and a half each, so they are opt-in: MUTATE_E2E=1 node scripts/mutation-check.mjs
const E2E_MUTATIONS = [
  ["the Owner's switch actually disables the button", PHOTOS,
    "                      disabled={reading || !!readingStatus?.refusal}", "                      disabled={reading}", E2E],
  ["only original photographs can be chosen for reading", PHOTOS,
    '              {picking && m.kind === "original" && (', "              {picking && (", E2E],
  ["Edit Details really has somewhere to type a plate", PROFILE,
    '              label="License Plate"\n              value={str("license_plate")}',
    '              label="Listing Name"\n              value={str("nickname")}', PLATE_E2E],
  ["the plate state is chosen, not typed", PROFILE,
    "            <Choice\n              label=\"Plate State\"\n              value={str(\"plate_state\")}\n              onChange={(v) => set(\"plate_state\", v)}\n              options={usStateOptions()}",
    "            <Text\n              label=\"Plate State\"\n              value={str(\"plate_state\")}\n              onChange={(v) => set(\"plate_state\", v)}\n              hint={undefined}", PLATE_E2E],
  ["a drawer handed to another section does not carry stale edits", PROFILE,
    "          key={editing}\n", "", PLATE_E2E],
  ["accepting a detail reloads the vehicle profile", PHOTOS,
    "                          window.dispatchEvent(new Event(\"vehicle-profile-refresh\"));\n                        }\n                      }}",
    "                        }\n                      }}", E2E],
];

const ALL = process.env.MUTATE_E2E ? [...MUTATIONS, ...E2E_MUTATIONS] : MUTATIONS;

let blockers = 0;
for (const [what, file, from, to, suite] of ALL) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(from)) {
    console.log(`  BLOCKER  ${what}\n           anchor no longer present in ${file} — update scripts/mutation-check.mjs`);
    blockers++;
    continue;
  }
  const bak = `${file}.mutbak`;
  copyFileSync(file, bak);
  try {
    writeFileSync(file, src.replace(from, to));
    // A browser suite asks the dev server for the file it is mid-way through
    // recompiling, and a page that failed to build fails every assertion —
    // including the ones this mutation was not about. Observed: a dropdown
    // mutation whose first red line was a field three checks earlier. Let HMR
    // settle so the suite goes red for the reason under test.
    if (/-e2e\.test\.mjs$/.test(suite)) await new Promise((r) => setTimeout(r, 6000));
    const run = spawnSync("node", [suite], { encoding: "utf8" });
    if (run.status === 0) {
      console.log(`  BLOCKER  ${what}\n           ${suite.split("/").pop()} still passed with the guard removed`);
      blockers++;
    } else {
      console.log(`  PASS     ${what}`);
    }
  } finally {
    renameSync(bak, file);
  }
}
for (const f of [RULES, CORE, INBOX, DOORWAY, PHOTOS, PANEL, CAP, RULES2, READY, INSPFN, INSPUI, PROFILE, ADMIN, VEH, EDITOR]) {
  if (existsSync(`${f}.mutbak`)) { console.log(`  BLOCKER  ${f} was left mutated`); blockers++; }
}
console.log(blockers ? `\n${blockers} guard(s) not covered by a failing test` : "\nevery guard has a test that fails without it");
process.exit(blockers ? 1 : 0);
