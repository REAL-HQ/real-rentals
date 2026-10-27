// Payment rows are financial history: nothing in the app deletes them; a charge entered in error
// is voided with a reason. Source checks (the database guard is proven separately by
// scripts/payments-delete-guard.db.test.mjs against a disposable Postgres).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name);
    console.log(e);
  }
}

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) files.push(p);
  }
};
walk("src");
const panel = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");

test("no source file deletes from payments", () => {
  const hits = files.filter((f) => /from\(\s*["']payments["']\s*\)[\s\S]{0,80}?\.delete\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(hits, []);
});

test("Payments: Delete is replaced by Void (Entered In Error), which records a required reason in notes", () => {
  assert.doesNotMatch(panel, />\s*Delete\s*</);
  assert.match(panel, /Void \(Entered In Error\)/);
  assert.match(panel, /if \(!reason\) return;/);
  assert.match(panel, /update\(p\.id, \{ status: "void", notes \}\)/);
});

test("Payments: Void is not offered on paid, refunded or already-void rows (those are refunded in Stripe)", () => {
  assert.match(panel, /\{!\["paid", "refunded", "void"\]\.includes\(String\(p\.status\)\) && \(/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
