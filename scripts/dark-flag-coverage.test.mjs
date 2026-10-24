// Every dark server-function module must be accounted for.
//
// scripts/dark-flag-gates.test.ts proves a STRICTER property for a few
// modules: they refuse BEFORE requireSupabaseAuth, so a request with no
// Authorization header gets the feature error rather than the auth error.
// Most dark modules instead check the flag as the first statement INSIDE the
// handler: auth runs first, but no database, Stripe or storage call happens
// while the feature is off. Both are safe. Neither is safe if a new dark
// module simply forgets to check at all.
//
// This test enumerates dark modules from source and fails when one is not in
// either list, so the release guarantee "incomplete features stay disabled"
// cannot quietly drift. Run: node scripts/dark-flag-coverage.test.mjs
import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";

const LIB = "src/lib";
const GATES_TEST = "scripts/dark-flag-gates.test.ts";

// 1. Proven by the behavioural test: it calls them with no Authorization
//    header and asserts the feature error, not the auth error.
const PROVEN_BEFORE_AUTH = new Set([
  "billing-controls.functions.ts",
  "closeout-preview.functions.ts",
  "incident-charge-prep.functions.ts",
  "maintenance-due-schedule.functions.ts",
  "maintenance-due.functions.ts",
  "replacement-agreement.functions.ts",
  "vehicle-swap.functions.ts",
  "stalled-applications.functions.ts",
]);

// 2. Source shows a gate middleware placed AHEAD of requireSupabaseAuth, so
//    they refuse before auth too — but the behavioural test does not call them
//    yet. The ordering is asserted mechanically below, not taken on trust.
const GATE_BEFORE_AUTH = new Set([
  "agreement-pending-signatures.functions.ts",
  "overview-today.functions.ts",
  "portal-payment-history.functions.ts",
]);

// 4. Live features that merely REFERENCE a dark flag for one sub-path. These
//    are not dark modules: getAvailability and getMyPortalAccess serve real
//    traffic today. Listing them stops the scan from mis-classifying a live
//    module as dark, which would make this test meaningless in the other
//    direction.
//    applications.functions.ts and documents.functions.ts are the M2 pair:
//    Approve, the application list and the document vault all serve real
//    traffic. The two M2 flags only tighten one sub-path each — the legacy
//    approval fallback's status refusal, and whether an upload is hashed —
//    and neither flag can stop a live call.
const MIXED_LIVE = new Set([
  "portal-access.functions.ts",
  "waitlist.functions.ts",
  "applications.functions.ts",
  "documents.functions.ts",
]);

// Modules whose flag check is the first statement in the handler: auth runs
// first, then the flag refuses before any data access. Verified by reading
// each one. A module may only sit here if its flag check precedes every
// supabase/Stripe/storage call in the handler.
// 3. Flag check is the first statement inside the handler: auth runs first,
//    then the flag refuses before any database, Stripe or storage call.
const FLAG_FIRST_IN_HANDLER = new Set([
  "application-timeline.functions.ts", "next-steps.functions.ts",
  "accountant-export.functions.ts", "agreements.functions.ts",
  "application-status.functions.ts", "billing-health.functions.ts",
  "collections-watch.functions.ts", "deposit-ledger.functions.ts",
  "deposits-ledger.functions.ts", "driver-issues.functions.ts",
  "driver-statement.functions.ts", "expense-categories.functions.ts",
  "expense-export.functions.ts", "expense-receipt-gaps.functions.ts",
  "finance-data-quality.functions.ts", "finance-deposit-ledger.functions.ts",
  "fleet-calendar.functions.ts", "incident-aging.functions.ts",
  "maintenance-log.functions.ts", "owner-expense-entry.functions.ts",
  "owner-finance-snapshot.functions.ts", "owner-pnl.functions.ts",
  "partner-statement.functions.ts", "payout-breakdown.functions.ts",
  "photo-enhance.functions.ts", "receivables-aging.functions.ts",
  "record-rental.functions.ts", "record-rental-evidence.functions.ts",
  "renewals-due.functions.ts",
  "rent-aging.functions.ts", "rent-reconciliation.functions.ts",
  "rental-payments.functions.ts", "rentals.functions.ts",
  "return-checklist.functions.ts", "revenue-forecast.functions.ts",
  "stripe-match.functions.ts", "stripe-payout-recon.functions.ts",
  "stripe-risk-monitor.functions.ts", "stripe-unmatched.functions.ts",
  "tax-export.functions.ts", "todays-ops.functions.ts",
  "tolls-tickets.functions.ts", "unified-finance.functions.ts",
  "vehicle-pnl.functions.ts", "vehicle-profitability.functions.ts",
  "vehicle-turnaround.functions.ts", "weekly-cash-flow.functions.ts",
  // verifyApprovalIdentity throws IDENTITY_VERIFICATION_HOLD as the first
  // statement in the handler, ahead of the requireManager import and lookup
  // and ahead of both preview_approval_identity and verify_approval_identity.
  "identity-verification.functions.ts",
]);

const libFiles = readdirSync(LIB);
const source = Object.fromEntries(
  libFiles.filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(`${LIB}/${f}`, "utf8")]),
);

// A flag counts as dark only if some module declares it a hard false.
const hardFalse = new Set();
for (const text of Object.values(source)) {
  // The optional type annotation matters: STALLED_APPLICATIONS_ENABLED is
  // declared `: boolean = false`, and a regex without it silently under-counts
  // the dark surface — which is the one thing this test exists to prevent.
  for (const m of text.matchAll(/export const ([A-Z0-9_]+_ENABLED)\s*(?::\s*boolean\s*)?=\s*false/g)) hardFalse.add(m[1]);
}
assert.ok(hardFalse.size > 0, "no hard-false flags found — the scan is broken");

// A module counts as dark when it NAMES a hard-false flag. That rule is
// narrow on purpose. A wider rule -- "imports any symbol matching /Enabled/
// from a module that declares a hard-false flag" -- was tried and pulled in 23
// live features (booking conversion, onboarding checklist, driver doc expiry
// and more), because those modules import unrelated symbols from files that
// happen to also declare a dark flag. A scan that over-reports forces unverified
// classifications, which is worse than not scanning: the lists below are only
// worth anything if every entry was actually read.
//
// Known limitation: a module that gates through an imported helper without
// naming the flag is invisible here. stalled-applications.functions.ts calls
// assertStalledApplicationsEnabled() and is the one known case, listed below.
// Add any other such module by hand when it appears.
const HELPER_GATED = new Set(["stalled-applications.functions.ts"]);

const darkModules = libFiles
  .filter((f) => f.endsWith(".functions.ts"))
  .filter((f) => HELPER_GATED.has(f)
    || [...source[f].matchAll(/\b([A-Z0-9_]+_ENABLED)\b/g)].some((m) => hardFalse.has(m[1])))
  .sort();
assert.ok(darkModules.length > 0, "no dark server-function modules found — the scan is broken");

const unaccounted = darkModules.filter(
  (f) => !PROVEN_BEFORE_AUTH.has(f) && !GATE_BEFORE_AUTH.has(f)
      && !FLAG_FIRST_IN_HANDLER.has(f) && !MIXED_LIVE.has(f),
);
assert.deepEqual(
  unaccounted, [],
  `Dark server-function module(s) not accounted for:\n  ${unaccounted.join("\n  ")}\n` +
  `Read each one, then add it to exactly one list: PROVEN_BEFORE_AUTH (and to ` +
  `${GATES_TEST}), GATE_BEFORE_AUTH, FLAG_FIRST_IN_HANDLER, or MIXED_LIVE.`,
);

// The stricter list must stay honest: each entry really is imported by the
// behavioural test. Otherwise a module could be parked there untested.
const gates = readFileSync(GATES_TEST, "utf8");
for (const f of PROVEN_BEFORE_AUTH) {
  assert.ok(
    gates.includes(f.replace(/\.ts$/, "")),
    `${f} is listed as refusing before auth but ${GATES_TEST} does not import it`,
  );
}

// GATE_BEFORE_AUTH is a claim about source order, so check it mechanically:
// the gate middleware must appear before requireSupabaseAuth in the array.
for (const f of GATE_BEFORE_AUTH) {
  const text = source[f] ?? "";
  const chain = text.match(/\.middleware\(\[([^\]]*)\]\)/);
  assert.ok(chain, `${f} is listed as gating before auth but has no .middleware([...]) chain`);
  const names = chain[1].split(",").map((x) => x.trim());
  const authAt = names.indexOf("requireSupabaseAuth");
  assert.ok(authAt > 0,
    `${f} is listed as gating before auth but requireSupabaseAuth is first (or absent): [${names.join(", ")}]`);
}

// No list may name a module that is no longer dark, or does not exist.
for (const [name, list] of [["PROVEN_BEFORE_AUTH", PROVEN_BEFORE_AUTH],
                            ["GATE_BEFORE_AUTH", GATE_BEFORE_AUTH],
                            ["FLAG_FIRST_IN_HANDLER", FLAG_FIRST_IN_HANDLER],
                            ["MIXED_LIVE", MIXED_LIVE]]) {
  for (const f of list) {
    assert.ok(source[f] !== undefined, `${name} names ${f}, which does not exist`);
    assert.ok(darkModules.includes(f), `${name} names ${f}, which is no longer a dark module — remove it`);
  }
}

console.log(
  `dark flag coverage: ${darkModules.length} modules referencing a hard-false flag — ` +
  `${PROVEN_BEFORE_AUTH.size} proven before auth by test, ` +
  `${GATE_BEFORE_AUTH.size} gate before auth by source, ` +
  `${FLAG_FIRST_IN_HANDLER.size} flag-first in handler, ` +
  `${MIXED_LIVE.size} live with a dark sub-path, 0 unaccounted`,
);
