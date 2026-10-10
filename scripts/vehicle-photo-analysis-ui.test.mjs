/**
 * The parts of Read Photos that live in the browser.
 *
 * These are structural checks over the component source, not a rendered page:
 * they verify the wiring that a server test cannot see — that approving a
 * field refreshes the profile, that only originals can be chosen, that the
 * evidence thumbnail is fetched through the staff storage download rather
 * than the public listing route, and that the new markup is laid out for a
 * phone as well as a desktop.
 *
 * Comments are stripped before anything is matched. An earlier suite in this
 * repository "passed" by finding its own explanatory comment, and a prose
 * sentence is not a guarantee about behaviour.
 *
 * Every assertion here is mutation-tested: scripts/mutation-check.mjs removes
 * the line each one depends on and requires this file to go red.
 *
 * Run: node scripts/vehicle-photo-analysis-ui.test.mjs  (wired into npm test)
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

/** Source with comments and string literals' prose removed, so matches are code. */
function code(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

const photos = code("src/components/admin/VehiclePhotos.tsx");
const panel = code("src/components/admin/VehicleSuggestions.tsx");

console.log("\napproving a detail read from a photo updates the vehicle on screen");
ok(/<VehicleSuggestions[\s\S]{0,600}?batchId=\{readBatch\}/.test(photos),
  "the Photos tab shows the review panel for the batch it just read");
const applied = /onApplied=\{\(written\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/.exec(photos);
ok(!!applied, "it passes an onApplied handler");
ok(!!applied && /if \(written > 0\)/.test(applied[1]),
  "  which acts only when the server actually wrote something");
ok(!!applied && /void refresh\(\)/.test(applied[1]),
  "  reloading the photo list");
ok(!!applied && /vehicle-profile-refresh/.test(applied[1]),
  "  and telling the profile to reload, so Readiness and the plate update");

console.log("\nchoosing what to read");
ok(/type="checkbox"[\s\S]{0,400}?checked=\{chosen\.has\(m\.id\)\}/.test(photos),
  "each photo can be ticked individually");
ok(/\{picking && m\.kind === "original" &&/.test(photos),
  "only original photographs can be chosen — a retouched copy is not evidence");
ok(/disabled=\{reading \|\| chosen\.size === 0\}/.test(photos),
  "the Read button is dead until something is chosen");
ok(/aria-label=\{`Read \$\{m\.file_name/.test(photos),
  "each checkbox says which photo it is for");

console.log("\nthe operator can see what is happening and what went wrong");
ok(/\{reading \?\s*"Reading…"/.test(photos), "the button reports that it is working");
ok(/readState/.test(photos) && /readErrors\.map/.test(photos),
  "per-photo progress and per-photo errors are both rendered");
ok(/setReadNote\("Still reading/.test(photos),
  "a read that outlasts the watch says so instead of spinning for ever");

console.log("\nthe source photograph is reachable from the review, privately");
ok(/loadStaffPhoto\(path\)/.test(panel),
  "the thumbnail is fetched with the staff storage download");
ok(!/resolvePhotoUrl/.test(panel),
  "  and never through the public listing route, which would only serve published photos anyway");
ok(/\{s\.photoPath && <EvidencePhoto/.test(panel),
  "a row read from a photo shows that photo");
ok(/onOpen=\{setViewing\}/.test(panel) && /src=\{viewing\}/.test(panel),
  "  and it opens full size when clicked");
ok(/Read From A Photo/.test(panel), "the row says the value came from a photograph");

console.log("\nit works on a phone as well as a desktop");
ok(/grid-cols-2 sm:grid-cols-3 lg:grid-cols-4/.test(photos),
  "the photo grid reflows from two columns to four");
ok(/<div className="mb-3 rounded-xl border border-\[#EDEDF0\] bg-\[#FAFAFB\] p-3">[\s\S]{0,200}?flex flex-wrap items-center gap-2/.test(photos),
  "the Read Photos bar wraps rather than overflowing a narrow screen");
ok(/basis-full sm:basis-auto/.test(photos),
  "  its explanatory line takes its own row on a phone");
const newMarkup = /Read Photos For Vehicle Details[\s\S]*?<div className="grid grid-cols-2/.exec(photos)?.[0] ?? "";
ok(newMarkup.length > 0 && !/\bw-\[\d{3,}px\]|\bmin-w-\[\d{3,}px\]/.test(newMarkup),
  "nothing in the new markup is pinned to a desktop-only width");
ok(/max-h-\[90vh\] max-w-full object-contain/.test(panel),
  "the full-size photo fits the screen it is opened on");

console.log("\nthe tab still does its original job");
ok(/label="Add Photos"/.test(photos), "uploading photos is untouched");
ok(/No photos are on the website yet/.test(photos), "so is the Listing Ready warning");
ok(/onPublish=\{\(v\) => patch\(m, \{ id: m\.id, published: v \}\)\}/.test(photos), "so is publishing");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
