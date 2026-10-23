// proposed/rehearsal/drizzle-prerequisites.sql must stay a faithful extract of
// the Drizzle migrations, must cover the three objects the packet expects, and
// must not be a way to smuggle a packet change.
//
// Run: node scripts/m2-rehearsal-prerequisites.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "./m2-rehearsal-prerequisites.mjs";

const PATH = "proposed/rehearsal/drizzle-prerequisites.sql";
const sql = readFileSync(PATH, "utf8");

assert.equal(sql, build(), `${PATH} has drifted from the Drizzle migrations`);

// The three gaps docs/m2-rehearsal.md records, and nothing less.
assert.match(sql, /CREATE TABLE public\.application_identity_reviews/, "identity reviews table missing");
assert.match(sql, /CREATE TABLE public\.application_waitlist_holds/, "waitlist holds table missing");
assert.match(sql, /ADD COLUMN IF NOT EXISTS deleted_at timestamptz/, "applications.deleted_at missing");
for (const col of ["deleted_by uuid", "deleted_reason text", "purged_at timestamptz", "legal_hold boolean"]) {
  assert.ok(sql.includes(col), `the same ALTER statement must add ${col}`);
}

// Each extract is attributed to the migration it came from, so a reviewer can
// diff it against the source.
for (const f of [
  "drizzle/migrations/0014_waitlist_holds_and_safe_promotion.sql",
  "drizzle/migrations/0016_0016_driver_deletion_stage1.sql",
  "drizzle/migrations/0019_application_identity_reviews.sql",
  "drizzle/migrations/0020_identity_reviews_tighten_grants.sql",
]) {
  assert.ok(sql.includes(`-- from ${f}`), `missing attribution for ${f}`);
  readFileSync(f, "utf8"); // the source still exists
}

// Only what the packet needs: the rest of 0016 creates deletion tables and
// functions that reference further Drizzle tables, and must stay out.
for (const absent of ["deletion_events", "deletion_file_jobs", "waitlist_holds_guard", "promote_waitlist"]) {
  assert.ok(!sql.includes(absent), `${absent} is beyond the packet's prerequisites and must not be here`);
}

// One transaction, like every other file in this install.
assert.equal((sql.match(/^BEGIN;$/gm) || []).length, 1, "exactly one BEGIN");
assert.equal((sql.match(/^COMMIT;$/gm) || []).length, 1, "exactly one COMMIT");

// It is a rehearsal baseline, not a packet step: it must not reach into the
// packet's own namespace or privileges.
for (const forbidden of ["rr_record_executor", "rr_approval_executor", "rr_evidence_issuer", "GRANT CREATE"]) {
  assert.ok(!sql.includes(forbidden), `a baseline file must not mention ${forbidden}`);
}

// This is a baseline file, not a packet step. It lives outside
// proposed/m2-packet/, and it creates none of the objects the packet creates --
// so it can never stand in for a packet change. (That the packet files
// themselves are byte-unchanged is a git property, checked outside this test.)
assert.ok(!PATH.startsWith("proposed/m2-packet/"), "the baseline must live outside the packet directory");
for (const packetObject of [
  "private.approval_operations",
  "private.record_operations",
  "public.booking_vehicle_assignments",
  "approve_application_checked",
  "record_uploaded_content_sha",
  "end_rental_safe_v1",
]) {
  assert.ok(!sql.includes(packetObject), `the baseline must not create ${packetObject}: the packet does`);
}

console.log(
  "rehearsal prerequisites: identity reviews, waitlist holds and the five deletion columns extracted from " +
  "0014/0016/0019/0020 with attribution, nothing beyond them, one transaction, no packet role or privilege",
);
