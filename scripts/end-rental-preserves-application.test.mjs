// The installed end_rental_tx closes the application. The proposal removes
// only that write, and the app keeps calling the installed function while
// END_RENTAL_PRESERVES_APPLICATION_ENABLED is the hard false.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = "supabase/migrations/20261006112250_6c73a4f7-a851-44fd-bdf1-f8fc85906eda.sql";
const proposalPath = "proposed/end-rental-preserves-application-v1.sql";
const applicationUpdate = "    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;\n";

function functionText(sql) {
  const match = sql.match(/CREATE(?: OR REPLACE)? FUNCTION public\.end_rental_tx\([\s\S]*?END \$function\$;/);
  assert.ok(match, "end_rental_tx function missing");
  return match[0].replace(/^CREATE OR REPLACE FUNCTION/, "CREATE FUNCTION");
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

assert.equal(installed.includes(applicationUpdate), true);
assert.equal(forward, installed.replace(applicationUpdate, ""));
assert.equal(forward.includes("UPDATE public.applications"), false);
assert.match(forward, /UPDATE public\.rentals SET status = 'closed'/);
assert.match(forward, /UPDATE public\.vehicles SET status = _vehicle_status/);
assert.match(forward, /UPDATE public\.automation_enrollments SET status = 'cancelled'/);

const rollbackCode = rollbackSql
  .split("\n")
  .filter((line) => line.startsWith("--"))
  .map((line) => (line.startsWith("-- ") ? line.slice(3) : line.slice(2)))
  .join("\n");
assert.equal(functionText(rollbackCode), installed);
assert.match(rollbackCode, /UPDATE public\.applications SET status = 'closed'/);
assert.equal(
  rollbackSql
    .split("\n")
    .filter((line) => /UPDATE public\.applications/.test(line))
    .every((line) => line.trimStart().startsWith("--")),
  true,
);

const flag = readFileSync("src/lib/end-rental-preserves-application.ts", "utf8");
const ui = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const rentals = readFileSync("src/lib/rentals.functions.ts", "utf8");
assert.match(flag, /export const END_RENTAL_PRESERVES_APPLICATION_ENABLED = false as boolean;/);
assert.doesNotMatch(flag, /END_RENTAL_PRESERVES_APPLICATION_ENABLED\s*=\s*true\b/);
assert.match(ui, /if \(END_RENTAL_PRESERVES_APPLICATION_ENABLED !== true\) \{\n\s*onSaved\(\{ status: "closed" \}\);\n\s*\}/);
assert.match(rentals, /rpc\("end_rental_tx"/);
assert.doesNotMatch(rentals, /END_RENTAL_PRESERVES_APPLICATION_ENABLED/);
assert.doesNotMatch(rentals, /\.from\("applications"\)\s*\.update/);
assert.equal(
  walk("supabase/migrations").some((path) => path.includes("end-rental-preserves")),
  false,
);
assert.equal(walk("proposed").filter((path) => path.endsWith("end-rental-preserves-application-v1.sql")).length, 1);

console.log("end rental preserves application: ok");
