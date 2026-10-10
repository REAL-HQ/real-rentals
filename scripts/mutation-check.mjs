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

const SERVER = "scripts/vehicle-photo-analysis.test.mjs";
const CHANNEL = "scripts/safe-autofill-channel.test.mjs";
const UI = "scripts/vehicle-photo-analysis-ui.test.mjs";

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
  ["the evidence thumbnail uses the staff storage download", PANEL,
    "    void loadStaffPhoto(path).then((u) => { if (live) setUrl(u); });",
    "    void Promise.resolve(null).then((u) => { if (live) setUrl(u); });", UI],
];

let blockers = 0;
for (const [what, file, from, to, suite] of MUTATIONS) {
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
for (const f of [RULES, CORE, INBOX, DOORWAY, PHOTOS, PANEL]) {
  if (existsSync(`${f}.mutbak`)) { console.log(`  BLOCKER  ${f} was left mutated`); blockers++; }
}
console.log(blockers ? `\n${blockers} guard(s) not covered by a failing test` : "\nevery guard has a test that fails without it");
process.exit(blockers ? 1 : 0);
