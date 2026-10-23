// The payments webhook runs in production for every Stripe event, gated by no
// feature flag. src/lib/AGENTS.md fixes three rules for it:
//
//   - a payments row is a charge written before collection; the webhook only
//     moves status and never un-pays,
//   - notices are claimed via notified_status so a replay cannot email twice,
//   - the webhook never writes a second charge.
//
// PR #266 changes this file by +212/-42 and nothing tested it. These are
// structural assertions over the source: they cannot prove runtime behaviour,
// but they do fail when a guard is dropped from a statement, which is the way
// these invariants actually get broken.
//
// Run: node scripts/payments-webhook-invariants.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const FILE = "src/routes/api/public/payments/webhook.ts";
const src = readFileSync(FILE, "utf8");
const lines = src.split("\n");

/** Collect each supabase statement that starts at a `from('payments')` call. */
function paymentsStatements() {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\bfrom\('payments'\)/.test(lines[i])) continue;
    // Accumulate to the end of the statement, not the end of the line. An
    // earlier terminator stopped on a trailing ")" and so missed the guards
    // on the continuation line, reporting a false violation.
    let text = "";
    for (let j = i; j < lines.length && j < i + 12; j++) {
      text += lines[j] + "\n";
      if (/;\s*(\/\/.*)?$/.test(lines[j])) break;
    }
    out.push({ line: i + 1, text });
  }
  return out;
}

const statements = paymentsStatements();
assert.ok(statements.length >= 8, `expected several payments statements, found ${statements.length} — the scan is broken`);

// ---- 1. Never un-pays -------------------------------------------------------
// Any update that writes `status` must refuse rows already paid or refunded.
// `notified_status: 'paid'` contains `status: 'paid'` as a substring, so a
// loose match classifies a notice claim as a status write and reports a
// violation that is not there. Only a bare `status:` key counts.
const BARE_STATUS = /(?<![_A-Za-z])status:\s*'/;
const statusWrites = statements.filter((s) => /\.update\(/.test(s.text) && BARE_STATUS.test(s.text));
assert.ok(statusWrites.length >= 3, `expected several status writes, found ${statusWrites.length}`);
for (const s of statusWrites) {
  assert.match(s.text, /\.neq\('status',\s*'paid'\)/,
    `${FILE}:${s.line} writes payments.status without .neq('status','paid') — this can un-pay a collected row`);
  assert.match(s.text, /\.neq\('status',\s*'refunded'\)/,
    `${FILE}:${s.line} writes payments.status without .neq('status','refunded')`);
}

// An update built from a variable (`\.update(patch)`) has no literal `status:`
// key, so the check above skips it entirely. Close that: EVERY payments update
// must either be a notified_status claim or carry both guards.
const allUpdates = statements.filter((s) => /\.update\(/.test(s.text));
for (const s of allUpdates) {
  const isNoticeClaim = /\.update\(\{\s*notified_status:/.test(s.text);
  if (isNoticeClaim) continue;
  assert.match(s.text, /\.neq\('status',\s*'paid'\)/,
    `${FILE}:${s.line} updates payments without .neq('status','paid') — this can un-pay a collected row`);
  assert.match(s.text, /\.neq\('status',\s*'refunded'\)/,
    `${FILE}:${s.line} updates payments without .neq('status','refunded')`);
}

// ---- 2. Notices are claimed, not just sent ---------------------------------
// Every notified_status write must be a conditional claim, so two concurrent
// deliveries of the same Stripe event cannot both win and email twice.
const noticeWrites = statements.filter((s) => /\.update\(\{\s*notified_status:/.test(s.text));
assert.ok(noticeWrites.length >= 2, `expected notified_status claims, found ${noticeWrites.length}`);
for (const s of noticeWrites) {
  assert.match(s.text, /\.or\(\s*[`'"]notified_status\.is\.null,notified_status\.neq\./,
    `${FILE}:${s.line} sets notified_status without the is-null/neq claim guard — a replay could email twice`);
}

// ---- 3. The unmatched-invoice warnings never write a charge ----------------
function bodyOf(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in ${FILE}`);
  let depth = 0, seen = false, end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") { depth++; seen = true; }
    else if (src[i] === "}") { depth--; if (seen && depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}
for (const fn of ["warnUnmatchedInvoice", "warnUnmatchedPayment"]) {
  const body = bodyOf(fn);
  assert.doesNotMatch(body, /from\('payments'\)[\s\S]{0,200}?\.insert\(/,
    `${fn} inserts a payments row — an unmatched warning must only log`);
  assert.match(body, /console\.warn/, `${fn} no longer logs; the unmatched shape would be lost`);
}

// ---- 4. A manually-paid row keeps its manual record ------------------------
// Staff mark a failed invoice paid while failure_reason is still set. The
// webhook must not overwrite that with a later Stripe event.
assert.match(src, /function failureReasonStillSet\(/,
  "failureReasonStillSet is gone — manual paid rows would be overwritten");
assert.match(src, /manualIds\s*=\s*alreadyPaid\s*\.filter\(\s*\(row: any\)\s*=>\s*failureReasonStillSet\(row\.failure_reason\)\)/,
  "manualIds is no longer derived from failureReasonStillSet over already-paid rows");
assert.match(src, /const openIds\s*=\s*ids\.filter\(\(id\)\s*=>\s*!alreadyPaidIds\.includes\(id\)\)/,
  "openIds no longer excludes already-paid rows, so a paid row could be rewritten");

// ---- 5. No feature flag gates this file ------------------------------------
// If someone adds one, the release reasoning in docs/release/266-rc-independence.md
// changes and must be revisited.
assert.doesNotMatch(src, /\b[A-Z0-9_]+_ENABLED\b/,
  `${FILE} now references a feature flag; revisit docs/release/266-rc-independence.md`);

console.log(
  `payments webhook invariants: ${statements.length} payments statements — ` +
  `${statusWrites.length} status writes guarded, ${noticeWrites.length} notice claims guarded, ` +
  `warn helpers write no charge, manual paid rows preserved`,
);
