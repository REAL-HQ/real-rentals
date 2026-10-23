// Option B v3 must be HOSTED-INSTALL step 4's end_rental_safe_v1 with exactly
// one statement changed, and its rollback must reproduce step 4's function byte
// for byte. proposed/m2-packet/02.sql is never edited to make this pass.
//
// Run: node scripts/closeout-option-b-v3.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { installedSafeRelease, derive, deriveRollback } from "./closeout-option-b-v3.mjs";

const packet = readFileSync("proposed/m2-packet/02.sql", "utf8");
const forward = readFileSync("proposed/closeout-option-b/end-rental-safe-returns-approved-v3.sql", "utf8");
const back = readFileSync("proposed/closeout-option-b/rollback-end-rental-safe-returns-approved-v3.sql", "utf8");

// Committed files are what the generator produces now.
assert.equal(forward, derive(packet), "the forward file has drifted from 02.sql");
assert.equal(back, deriveRollback(packet), "the rollback file has drifted from 02.sql");

const installed = installedSafeRelease(packet);
const sqlOf = (text) => text.slice(text.indexOf("CREATE OR REPLACE FUNCTION"), text.lastIndexOf("\nCOMMIT;"));

// Exactly one statement differs, and it is the applications.status write.
const a = installed.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION").split("\n");
const b = sqlOf(forward).split("\n");
const onlyInInstalled = a.filter((l) => !b.includes(l));
const onlyInForward = b.filter((l) => !a.includes(l));
assert.deepEqual(onlyInInstalled, ["    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;"],
  `more than the closing write differs: ${JSON.stringify(onlyInInstalled)}`);
assert.deepEqual(onlyInForward, [
  "    UPDATE public.applications SET status = 'approved'",
  "      WHERE id = r.application_id AND status = 'active';",
], `the replacement is not the Option B statement: ${JSON.stringify(onlyInForward)}`);

// The guard is load-bearing: a proposal without it must not pass this test.
assert.ok(sqlOf(forward).includes("AND status = 'active'"), "the status guard is missing");

// Round trip: the rollback is step 4's function exactly, modulo CREATE OR REPLACE.
assert.equal(sqlOf(back), installed.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
  "the rollback does not reproduce step 4's function");

// Attributes every per-step verify from step 4 onward asserts for this signature.
for (const [name, text] of [["forward", forward], ["rollback", back]]) {
  assert.ok(sqlOf(text).includes("SECURITY DEFINER"), `${name} drops SECURITY DEFINER`);
  assert.ok(sqlOf(text).includes("SET search_path=''"), `${name} drops the empty search_path`);
  assert.ok(text.includes("CREATE OR REPLACE FUNCTION public.end_rental_safe_v1("),
    `${name} must replace, not create: the function exists by the time it runs`);
  assert.ok(!sqlOf(text).includes("end_rental_tx"),
    `${name} must not touch end_rental_tx -- step 4's wrapper has to survive`);
  assert.ok(/^BEGIN;$/m.test(text) && /^COMMIT;$/m.test(text), `${name} must be one transaction`);
  assert.equal((text.match(/^COMMIT;$/gm) || []).length, 1, `${name} must commit exactly once`);
}

// The recorded-rental closeout needs no change, which is why only one file does.
const recorded = readFileSync("proposed/m2-packet/04.sql", "utf8");
assert.ok(!/UPDATE public\.applications SET/.test(recorded),
  "04.sql now writes applications.status; close_recorded_rental_v2 would need Option B too");

// The packet is untouched.
assert.ok(packet.includes("UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;"),
  "02.sql must still carry its own closing write -- the packet is not edited");

console.log(
  "option B v3: step 4's end_rental_safe_v1 with one statement changed, guard present, " +
  "rollback round-trips to step 4 exactly, SECURITY DEFINER and empty search_path kept, " +
  "end_rental_tx untouched, close_recorded_rental_v2 needs no change",
);
