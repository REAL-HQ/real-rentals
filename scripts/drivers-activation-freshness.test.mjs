/**
 * P2 (PR 323 follow-up): the Drivers list's activation context — vehicles,
 * screenings and vault documents — must re-read after any committed readiness
 * change, and a late response from an older read must never overwrite a newer
 * one. Wiring assertions only; the server stays the authority on readiness.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const drivers = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const reads = readFileSync("src/lib/latest-driver-reads.ts", "utf8");

// One shared refresh counter, declared once.
assert.equal((drivers.match(/const \[activationRefresh, setActivationRefresh\]/g) ?? []).length, 1, "activationRefresh declared exactly once");

// The vehicles / screenings / documents effect is generation-guarded and re-runs on refresh.
const ctxStart = drivers.indexOf('readVersions.begin("activation-context")');
assert.ok(ctxStart > 0, "activation context read must take a read generation");
const ctx = drivers.slice(ctxStart, drivers.indexOf("const loadReviewAging", ctxStart));
for (const table of ["vehicles", "driver_screenings", "documents"]) {
  assert.match(ctx, new RegExp(`from\\("${table}"\\)`), `${table} is re-read in the activation context`);
}
assert.equal((ctx.match(/if \(!live \|\| !current\(\)\) return;/g) ?? []).length, 3, "each of the three reads ignores stale responses");
assert.match(ctx, /if \(error\) return failed\(\);/, "read errors surface instead of silently keeping stale readiness");
assert.match(ctx, /\[refreshDrivers, readVersions, activationRefresh\]/, "context re-reads when activationRefresh bumps");

// Other readiness inputs follow the same refresh.
for (const dep of [
  "[refreshOnboarding, activationRefresh]",
  "[loadDocExpiry, driversLoaded, canSeeSensitive, activationRefresh]",
  "[loadDocGaps, driversLoaded, canSeeSensitive, activationRefresh]",
  "[loadReviewAging, driversLoaded, canSeeSensitive, activationRefresh]",
]) assert.ok(drivers.includes(dep), `effect depends on activationRefresh: ${dep}`);
assert.match(drivers, /readVersions\.begin\("drivers"\)/, "driver rows are generation-guarded");
assert.match(drivers, /readVersions\.begin\("onboarding"\)/, "onboarding is generation-guarded");

// Triggers: committed readiness changes, opening Activate, list uploads, and activation itself.
assert.match(drivers, /addEventListener\(ACTIVATION_READINESS_REFRESH_EVENT, onReadinessChanged\)/, "panel listens for committed readiness changes");
assert.equal((drivers.match(/refreshActivationContext\(\); setListActivateId\(a\.id\);/g) ?? []).length, 2, "both Activate entry points refresh context first");
assert.match(drivers, /onUploaded=\{\(\) => \{\s*\/\/[^\n]*\n[^\n]*\n\s*refreshActivationContext\(\);\s*notifyActivationReadinessRefresh\(\{ applicationId: listUploadId \}\);/, "list Upload Docs refreshes context and rechecks an open dialog");
assert.match(drivers, /onActivated=\{\(\) => \{\s*setListActivateId\(null\);\s*refreshActivationContext\(\);/, "activation refreshes context");

// The read-generation helper itself.
assert.match(reads, /invalidateAll\(\) \{ epoch \+= 1; \}/);
const src = reads.replace(/export /g, "").replace(/new Map<[^>]*>/g, "new Map").replace(/\(key: string\)/g, "(key)");
const createDriverReadVersions = new Function(`${src}; return createDriverReadVersions;`)();
const v = createDriverReadVersions();
const a1 = v.begin("vehicles");
const a2 = v.begin("vehicles");
assert.equal(a1(), false, "older read is stale once a newer one starts");
assert.equal(a2(), true);
const b = v.begin("docs");
v.invalidateAll();
assert.equal(b(), false, "unmount invalidates every in-flight read");
console.log("drivers-activation-freshness: all checks passed");
