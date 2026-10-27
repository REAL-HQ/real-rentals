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
  assert.match(inv, /if \(status !== 'paid'\) q = q\.neq\('status', 'void'\)\.neq\('status', 'waived'\)[.;]/);
  assert.match(inv, /\.or\('status\.neq\.pending,last_attempt_at\.is\.null'\)/, "an invoice failure never fails a row our own collection has claimed");
});

const rules = readFileSync("src/lib/payment-status-rules.ts", "utf8");
const server = readFileSync("src/lib/payment-status.functions.ts", "utf8");
const changeFn = panel.slice(panel.indexOf("async function changeStatus"), panel.indexOf("async function add("));

test("Payments: Delete is replaced by Void (Entered In Error), which records a required reason in notes", () => {
  assert.doesNotMatch(panel, />\s*Delete\s*</);
  assert.match(panel, /Void \(Entered In Error\)/);
  assert.match(panel, /changeStatus\(p, driverName, "void"\)/);
  assert.match(changeFn, /if \(!reason \|\| reason\.length < 3\) return/);
  assert.match(server, /reason: z\.string\(\)\.trim\(\)\.min\(3\)/, "the server refuses a change without a reason");
  assert.match(server, /notes: \[row\.notes, `\$\{label\}: \$\{data\.reason\}`\]/);
});

test("Payments: the void is conditional on the row still having the status shown (a stale list never voids a paid row)", () => {
  assert.match(changeFn, /expectedStatus: String\(p\.status\)/);
  assert.match(server, /if \(row\.status !== data\.expectedStatus\)/);
  assert.match(server, /\.update\(patch\)\s*\.eq\("id", row\.id\)\s*\.eq\("status", row\.status\)\s*\.select\("id"\)/);
});

test("Payments: Void is offered only on unpaid, settled-nowhere statuses: never paid, refunded, waived, void or pending", () => {
  const m = rules.match(/export const OPEN_STATUSES = (\[[^\]]*\]) as const;/);
  assert.ok(m, "OPEN_STATUSES missing");
  const open = JSON.parse(m[1]);
  for (const s of ["paid", "refunded", "waived", "void", "pending"]) assert.ok(!open.includes(s), s);
  for (const s of ["failed", "unpaid", "current", "past_due"]) assert.ok(open.includes(s), s);
  assert.match(rules, /case "void":\s*return isOpen\(from\) \? "manager" : null;/);
  assert.match(panel, /\{canTake\(tier, "void", String\(p\.status\)\) && \(/);
});

test("Payments: before voiding, staff are told exactly how much is removed from what the driver owes", () => {
  assert.match(changeFn, /void: `Voiding removes \$\{money\} from what \$\{driverName\} owes\./);
  assert.ok(changeFn.indexOf("window.confirm(") < changeFn.indexOf("window.prompt(") && changeFn.indexOf("window.prompt(") < changeFn.indexOf("changePaymentStatus("), "confirm, then reason, then the server call");
  assert.match(server, /\.\.\.\(action === "mark_paid" \? \{ paid_date: today, balance_due: 0, payment_method: data\.method \} : \{\}\)/, "only Mark as Paid rewrites the balance; a void never does");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
