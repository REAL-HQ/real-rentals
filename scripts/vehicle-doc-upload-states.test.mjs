/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   THE DIALOG MUST NEVER TELL STAFF SOMETHING THAT IS NOT TRUE OF THE
 *   STORED STATE.
 *
 * Two false messages shipped, both from the same shortcut — inferring the
 * whole of the dialog's state from one boolean, "is anything busy?".
 *
 *   "Reading…"  over a document that had finished fourteen seconds earlier
 *   "No new details to add — this vehicle already has every value the
 *    document shows"  over a duplicate whose details were never applied,
 *    over a reading that had failed, and over a document belonging to a
 *    different car
 *
 * One boolean cannot tell "nothing has happened yet" from "everything has
 * finished", and it cannot tell those three empty cases apart at all. The
 * rules now live in a pure module, and this is what pins them down.
 *
 * Run: node scripts/vehicle-doc-upload-states.test.mjs  (wired into npm test)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const OUT = ".vdocstates-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
execFileSync("npx", ["esbuild", "src/lib/vehicle-doc-upload.ts", "--bundle", "--platform=node",
  "--format=esm", "--alias:@=./src", `--outfile=${OUT}/m.mjs`, "--log-level=warning"], { stdio: "inherit" });
const m = await import(`../${OUT}/m.mjs`);

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const item = (over = {}) => ({
  id: "i1", fileName: "registration.jpg", status: "ready", docClass: "registration",
  error: null, reviewable: false, applied: false, ...over,
});
const review = (over = {}) => m.reviewState({
  items: [item()], suggestions: 0, conflicts: 0, possibleMatches: 0,
  needsVerification: 0, otherVehicles: 0, ...over,
});

console.log("ONE FILE'S MILESTONE IS A FACT ABOUT STORED STATE");
for (const s of ["uploaded", "analyzing", "matching"]) {
  const f = m.fileState(item({ status: s }));
  ok(f.milestone === "document_saved", `"${s}" means the document is already saved`);
  ok(f.note === "Reading the details…", `  and reports that reading is still running`);
  ok(f.failed === false, "  and is not a failure");
}
{
  const f = m.fileState(item({ status: "ready" }));
  ok(f.milestone === "extraction_complete" && f.label === "Extraction Complete",
     "a read file with nothing to review is Extraction Complete, not Ready For Review");
  ok(f.note === "", "  with nothing extra to say");
}
{
  const f = m.fileState(item({ status: "ready", reviewable: true }));
  ok(f.milestone === "ready_for_review" && f.label === "Ready For Review",
     "a read file with pending details is Ready For Review");
}
{
  const f = m.fileState(item({ status: "ready", reviewable: true, applied: true }));
  ok(f.milestone === "profile_updated" && f.label === "Vehicle Profile Updated",
     "once a field is written the file reads Vehicle Profile Updated");
}
{
  const f = m.fileState(item({ status: "failed", error: "The page was unreadable." }));
  ok(f.failed === true, "a failed read is reported as a failure");
  ok(f.milestone === "document_saved", "  but never below Document Saved — the original IS kept");
  ok(/The page was unreadable\./.test(f.note) && /saved and linked/.test(f.note),
     "  and says both the reason and that the file is safe");
}
{
  const f = m.fileState(item({ status: "duplicate" }));
  ok(f.duplicate === true && f.milestone === "extraction_complete", "a duplicate is complete, not failed");
  ok(/already on file/.test(f.note) && /not stored again/.test(f.note),
     "  and explains it was linked rather than stored twice");
}

console.log("\nTHE STEP NEVER CLAIMS A SAVE NOBODY MADE");
ok(m.uploadStep([]) === 1, "nothing uploaded → step 1 Upload");
ok(m.uploadStep([item({ status: "analyzing" })]) === 1, "still reading → step 1");
ok(m.uploadStep([item({ status: "ready", reviewable: true })]) === 2, "read, details pending → step 2 Review");
ok(m.uploadStep([item({ status: "ready" })]) === 2, "read, nothing pending → still step 2, not 3");
ok(m.uploadStep([item({ status: "ready", applied: true })]) === 3, "a field applied → step 3 Save Changes");
ok(m.uploadStep([item({ status: "failed" })]) === 2, "a failed read is not a save");
ok(m.STEP_LABEL[3] === "Save Changes", "step 3 is labelled Save Changes");

console.log("\nCANCEL IS ONLY HONEST BEFORE ANYTHING IS COMMITTED");
ok(m.isCommitted({ items: [], savedDirect: 0 }) === false, "nothing uploaded yet → not committed");
ok(m.isCommitted({ items: [item()], savedDirect: 0 }) === true, "a read upload commits the file");
ok(m.isCommitted({ items: [], savedDirect: 1 }) === true,
   "a direct save commits it too — the case that used to show Cancel over a stored file");

console.log("\nEACH EMPTY REVIEW SAYS WHAT IS ACTUALLY TRUE");
ok(review({ items: [] }).kind === "empty", "no files → nothing to review");
ok(review({ items: [item({ status: "analyzing" })] }).kind === "reading", "still reading → reading, not empty");
ok(review({ suggestions: 3 }).kind === "ready", "pending details → ready");
ok(review({ conflicts: 1 }).kind === "ready", "a conflict alone is still worth showing");
ok(review({ possibleMatches: 1 }).kind === "ready", "a possible match alone is worth showing");
ok(review({ needsVerification: 1 }).kind === "ready", "a value needing verification is worth showing");
{
  const r = review({ items: [item({ status: "failed" })] });
  ok(r.kind === "empty" && /Nothing could be read/.test(r.message), "a failed read says nothing could be read");
  ok(!/already has every value/.test(r.message), "  and does NOT claim the vehicle already has the values");
}
{
  const r = review({ otherVehicles: 2 });
  ok(/belongs to another vehicle/.test(r.message), "details for other cars say so");
  ok(!/already has every value/.test(r.message), "  and do NOT claim the vehicle already has them");
}
{
  const r = review({ items: [item({ status: "duplicate" })] });
  ok(/already on file/.test(r.message) && /Fleet Inbox/.test(r.message),
     "a duplicate says it was linked and where its details are");
  ok(!/already has every value/.test(r.message), "  and does NOT claim the vehicle already has them");
}
{
  const r = review({});
  ok(/already has every value the document shows/.test(r.message),
     "and the genuinely-nothing-new case keeps the message that was always true");
}

console.log("\nPRECEDENCE: A FAILURE OUTRANKS A GUESS ABOUT WHY IT IS EMPTY");
{
  const r = review({ items: [item({ status: "failed" })], otherVehicles: 3 });
  ok(/Nothing could be read/.test(r.message), "all-failed wins over other-vehicle");
  const mixed = review({ items: [item({ status: "failed" }), item({ id: "i2", status: "ready" })] });
  ok(!/Nothing could be read/.test(mixed.message), "  but only when EVERY file failed");
}

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
