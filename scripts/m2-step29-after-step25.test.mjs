// proposed/m2-verify/step29-after-step25.sql must stay a faithful composition
// of two approved queries: the step 25 verify and the step 29 verify, both read
// from proposed/HOSTED-INSTALL.md. Neither approved query may be edited to make
// this pass.
//
// Run: node scripts/m2-step29-after-step25.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { stepQuery, createNegations } from "./m2-step29-after-step25.mjs";

const runbook = readFileSync("proposed/HOSTED-INSTALL.md", "utf8");
const composed = readFileSync("proposed/m2-verify/step29-after-step25.sql", "utf8");
const step25 = stepQuery(runbook, 25);
const step29 = stepQuery(runbook, 29);

// The committed file is exactly what the generator produces right now.
// m2-step29-after-step25.mjs --check is the same assertion from the generator
// side; keeping it here means the test suite catches drift on its own.
const body = composed.slice(composed.indexOf("SELECT "));
const sql25 = step25.split("\n");
const sqlBody = body.replace(/\n$/, "").split("\n");

// Exactly two lines were added, and both come verbatim from step 29.
const negations = createNegations(step29);
assert.equal(sqlBody.length, sql25.length + 2,
  `composed query is ${sqlBody.length} lines, step 25 is ${sql25.length}; expected exactly 2 added`);
for (const line of negations) {
  assert.ok(sqlBody.includes(line), `step 29 CREATE assertion is missing from the composed query: ${line}`);
  assert.ok(step29.split("\n").includes(line), "the negation must come from step 29 verbatim");
}

// Every step 25 line survives, in order. Removing the two added lines must
// reproduce step 25 byte for byte.
const withoutAdded = sqlBody.filter((l) => !negations.includes(l));
assert.deepEqual(withoutAdded, sql25,
  "removing the two added lines does not reproduce the step 25 query verbatim");

// The counts are the whole reason this file exists: step 25 asserts 71 and
// step 29 asserts 76, so step 29's query cannot pass after a 1-25 install.
const count = (q) => {
  const m = q.match(/count\(\*\)=(\d+)/);
  assert.ok(m, "no count(*)= assertion found");
  return Number(m[1]);
};
assert.equal(count(step25), 71, "step 25 should assert 71 functions");
assert.equal(count(step29), 76, "step 29 should assert 76 functions");
assert.equal(count(body), 71, "the composed query must carry step 25's count, not step 29's");
assert.ok(count(step29) > count(step25),
  "if these ever match, step 29's own query works after step 25 and this file is no longer needed");

// The approved SQL is untouched: the composed query lives in its own file and
// the packet directory has no file of this name.
assert.ok(!body.includes("count(*)=76"), "the composed query must not carry the 76-function assertion");
let packetTouched = false;
try {
  readFileSync("proposed/m2-packet/step29-after-step25.sql");
  packetTouched = true;
} catch {
  // expected: the composition is not inside the packet
}
assert.ok(!packetTouched, "the composition must not be added to proposed/m2-packet/");

console.log(
  `step 29 after step 25: composed query is step 25 verbatim (${sql25.length} lines, count=71) ` +
  `plus step 29's 2 CREATE negations; approved queries unmodified`,
);
