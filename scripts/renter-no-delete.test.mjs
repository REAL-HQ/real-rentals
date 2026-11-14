// Renters can upload new photos and replacement documents, but can never
// delete a past upload (Dolmar, Nov 14 2026). Staff delete paths are unchanged.
// Source-level guards: no renter-callable delete exists, no renter-facing UI
// offers one, and no migration grants a non-staff DELETE on files or documents.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let fail = 0;
const ok = (cond, msg) => { if (cond) console.log(`  PASS  ${msg}`); else { fail++; console.log(`  FAIL  ${msg}`); } };
const read = (p) => readFileSync(p, "utf8");
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

console.log("RENTERS CANNOT DELETE PAST UPLOADS");
const insp = read("src/lib/inspections.functions.ts");
ok(!/deleteOwnConditionMedia/.test(insp), "no renter delete server function for condition photos");
ok(!/driverCanDeleteConditionMedia/.test(insp), "no renter delete permission helper");
const staffDelete = /export const deleteConditionMedia[\s\S]*?\}\);/.exec(insp)?.[0] ?? "";
ok(/isStaff\(context\.supabase, context\.userId\)\)\) throw new Error\("Forbidden"\)/.test(staffDelete), "deleteConditionMedia stays staff-only");

const docs = read("src/lib/documents.functions.ts");
const delDoc = /export const deleteDocument[\s\S]*?\n {2}\}\);/.exec(docs)?.[0] ?? "";
ok(/isAdmin\(context\.supabase, context\.userId\)\)\) throw new Error\("Forbidden"\)/.test(delDoc), "deleteDocument is admin-only");
ok(/uploaded_by_role === "driver"/.test(delDoc), "driver-uploaded documents are permanent records even for admins");

// Renter-facing surfaces never call a delete function or show a delete control.
const renterFiles = ["src/routes/portal.tsx", ...walk("src/components/portal")].filter((f) => /\.tsx?$/.test(f));
for (const f of renterFiles) {
  const src = read(f);
  const bad = /(deleteConditionMedia|deleteOwnConditionMedia|deleteDocument|\.storage\.from\([^)]*\)\.remove\()/.exec(src);
  ok(!bad, `${f}: no file delete${bad ? ` (found ${bad[1]})` : ""}`);
}
const panel = read("src/components/admin/InspectionsPanel.tsx");
ok(!/can_delete/.test(panel), "the shared photo grid has no renter delete control");

// No migration grants a renter (non-staff) DELETE/ALL on storage objects,
// documents or condition media.
const STAFF = /(is_staff|is_manager|is_owner|has_role|is_admin|service_role)/i;
const policyRe = /create\s+policy\s+"?([^"\n]+?)"?\s+on\s+(storage\.objects|public\.documents|public\.condition_media|documents|condition_media)\b([\s\S]*?);/gi;
let checked = 0;
for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) {
  const sql = read(join("supabase/migrations", f));
  for (const m of sql.matchAll(policyRe)) {
    const body = m[3];
    if (!/for\s+(delete|all)\b/i.test(body)) continue;
    checked++;
    ok(STAFF.test(body), `${f}: policy "${m[1]}" (${m[2]}) delete is staff-only`);
  }
}
ok(checked > 0, `checked ${checked} delete policies in migrations`);

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall clear");
if (fail) process.exit(1);
