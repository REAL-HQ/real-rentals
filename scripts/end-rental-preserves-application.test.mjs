// The installed end_rental_tx closes the application. The approved proposal
// (Option B, v2) returns the renter to Approved instead, and only from
// 'active'. The app keeps calling the installed function while
// END_RENTAL_PRESERVES_APPLICATION_ENABLED is the hard false.
//
// This checks the proposal's TEXT. scripts/closeout-harness/run.sh checks what
// the two functions actually do, against a throwaway PostgreSQL.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = "supabase/migrations/20261006112250_6c73a4f7-a851-44fd-bdf1-f8fc85906eda.sql";
const proposalPath = "proposed/end-rental-returns-approved-v2.sql";
const supersededPath = "proposed/end-rental-preserves-application-v1.sql";
const closeWrite = "    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;\n";
const approveWrite =
  "    UPDATE public.applications SET status = 'approved'\n" +
  "      WHERE id = r.application_id AND status = 'active';\n";

function functionText(sql) {
  const match = sql.match(/CREATE(?: OR REPLACE)? FUNCTION public\.end_rental_tx\([\s\S]*?END \$function\$;/);
  assert.ok(match, "end_rental_tx function missing");
  return match[0].replace(/^CREATE(?: OR REPLACE)? FUNCTION/, "CREATE FUNCTION");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const installed = functionText(readFileSync(migrationPath, "utf8"));
const proposed = readFileSync(proposalPath, "utf8");
const marker = proposed.indexOf("-- ROLLBACK");
assert.ok(marker > 0);
const forwardSql = proposed.slice(0, marker);
const rollbackSql = proposed.slice(marker);
const forward = functionText(forwardSql);

// Exactly one statement changes: the close becomes a conditional return to Approved.
assert.equal(installed.includes(closeWrite), true);
assert.equal(forward, installed.replace(closeWrite, approveWrite));
assert.equal(forward.includes("status = 'closed' WHERE id = r.application_id"), false);

// The eligibility guard is the point of Option B. Without `AND status = 'active'`
// ending a rental would promote a suspended or declined driver back to Approved.
assert.match(forward, /SET status = 'approved'\n\s*WHERE id = r\.application_id AND status = 'active';/);

// Everything else the closeout does is untouched.
assert.match(forward, /UPDATE public\.rentals SET status = 'closed'/);
assert.match(forward, /UPDATE public\.vehicles SET status = _vehicle_status/);
assert.match(forward, /UPDATE public\.automation_enrollments SET status = 'cancelled'/);

// The rollback restores today's behaviour, and must be able to actually run:
// the migration's bare CREATE FUNCTION cannot re-apply over an existing function.
const rollbackCode = rollbackSql
  .split("\n")
  .filter((line) => line.startsWith("--"))
  .map((line) => (line.startsWith("-- ") ? line.slice(3) : line.slice(2)))
  .join("\n");
assert.equal(functionText(rollbackCode), installed);
assert.match(rollbackCode, /CREATE OR REPLACE FUNCTION public\.end_rental_tx\(/);
assert.doesNotMatch(rollbackCode, /\n\s*CREATE FUNCTION public\.end_rental_tx\(/);
assert.match(rollbackCode, /UPDATE public\.applications SET status = 'closed'/);
assert.equal(
  rollbackSql
    .split("\n")
    .filter((line) => /UPDATE public\.applications/.test(line))
    .every((line) => line.trimStart().startsWith("--")),
  true,
);

// v1 was Option A. It stays for the record and must not be installed.
const superseded = readFileSync(supersededPath, "utf8");
assert.match(superseded, /^-- SUPERSEDED on 2026-10-23 by proposed\/end-rental-returns-approved-v2\.sql\./);
assert.match(superseded, /do not install/);

const flag = readFileSync("src/lib/end-rental-preserves-application.ts", "utf8");
const ui = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const rentals = readFileSync("src/lib/rentals.functions.ts", "utf8");
assert.match(flag, /export const END_RENTAL_PRESERVES_APPLICATION_ENABLED = false as boolean;/);
assert.doesNotMatch(flag, /END_RENTAL_PRESERVES_APPLICATION_ENABLED\s*=\s*true\b/);
assert.match(ui, /if \(END_RENTAL_PRESERVES_APPLICATION_ENABLED !== true\) \{\n\s*onSaved\(\{ status: "closed" \}\);\n\s*\}/);
assert.match(rentals, /rpc\("end_rental_tx"/);
assert.doesNotMatch(rentals, /END_RENTAL_PRESERVES_APPLICATION_ENABLED/);
assert.doesNotMatch(rentals, /\.from\("applications"\)\s*\.update/);

// Neither proposal may sit in a directory that runs on deploy.
for (const name of ["end-rental-returns-approved", "end-rental-preserves"]) {
  assert.equal(walk("supabase/migrations").some((path) => path.includes(name)), false);
}
assert.equal(walk("proposed").filter((path) => path.endsWith("end-rental-returns-approved-v2.sql")).length, 1);

console.log("end rental returns approved (v2): ok");
