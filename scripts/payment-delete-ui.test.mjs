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

test("webhook: every failure write skips void and waived rows, so a late Stripe failure never reopens a charge", () => {
  const hook = readFileSync("src/routes/api/public/payments/webhook.ts", "utf8");
  assert.equal((hook.match(/\.neq\('status', 'void'\)\.neq\('status', 'waived'\)/g) ?? []).length, 3);
  const inv = hook.slice(hook.indexOf("async function upsertPaymentFromInvoice"));
  assert.match(inv, /if \(status !== 'paid'\) q = q\.neq\('status', 'void'\)\.neq\('status', 'waived'\);/);
});

test("Payments: Delete is replaced by Void (Entered In Error), which records a required reason in notes", () => {
  assert.doesNotMatch(panel, />\s*Delete\s*</);
  assert.match(panel, /Void \(Entered In Error\)/);
  assert.match(panel, /if \(!reason\) return;/);
  assert.match(panel, /\.update\(\{ status: "void", notes \}\)/);
});

test("Payments: the void is conditional on the row still being voidable (a stale list never voids a paid row)", () => {
  const fn = panel.slice(panel.indexOf("async function voidPayment"), panel.indexOf("async function add("));
  assert.match(fn, /\.update\(\{ status: "void", notes \}\)\s*\.eq\("id", p\.id\)\s*\.in\("status", \[\.\.\.VOIDABLE_STATUSES\]\)\s*\.select\("id"\)/);
  assert.match(fn, /if \(!data\?\.length\) return toast\.error\(/, "zero rows updated is reported, not shown as voided");
  assert.ok(fn.indexOf("if (!data?.length)") < fn.indexOf("setPayments("), "the list changes only after the database confirms");
});

test("Payments: Void is offered only on unpaid, settled-nowhere statuses: never paid, refunded, waived, void or pending", () => {
  const m = panel.match(/const VOIDABLE_STATUSES = new Set\((\[[^\]]*\])\);/);
  assert.ok(m, "VOIDABLE_STATUSES missing");
  const voidable = JSON.parse(m[1]);
  for (const s of ["paid", "refunded", "waived", "void", "pending"]) assert.ok(!voidable.includes(s), s);
  for (const s of ["failed", "unpaid", "current", "past_due"]) assert.ok(voidable.includes(s), s);
  assert.match(panel, /\{VOIDABLE_STATUSES\.has\(String\(p\.status\)\) && \(/);
});

test("Payments: before voiding, staff are told exactly how much is removed from what the driver owes", () => {
  assert.match(panel, /Voiding removes \$\$\{owed\.toLocaleString\(\)\} from what \$\{driverName\} owes\./);
  const fn = panel.slice(panel.indexOf("async function voidPayment"), panel.indexOf("async function add("));
  assert.ok(fn.indexOf("window.confirm(") < fn.indexOf("window.prompt(") && fn.indexOf("window.prompt(") < fn.indexOf(".update({ status: \"void\""), "confirm, then reason, then update");
  assert.doesNotMatch(fn, /balance_due:|amount:/, "a void never rewrites the amount or balance");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
