/** Read-only check that Application Resume is 0023 and phone-conflict 0022 stays. No SQL execution. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const journal = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8"));
const phone = journal.entries.find((e) => e.idx === 22);
const resume = journal.entries.find((e) => e.idx === 23);
assert.equal(phone.tag, "0022_waitlist_resolve_phone_conflict");
assert.equal(resume.tag, "0023_application_resume_atomic_security");
assert.ok(resume.when > phone.when, "0023 timestamp must follow 0022");
assert.equal(new Set(journal.entries.map((e) => e.tag.slice(0, 4))).size, journal.entries.length);

const prev = JSON.parse(readFileSync("drizzle/migrations/meta/0022_snapshot.json", "utf8"));
const next = JSON.parse(readFileSync("drizzle/migrations/meta/0023_snapshot.json", "utf8"));
assert.equal(next.prevId, prev.id);
assert.notEqual(next.id, prev.id);

const phoneSql = readFileSync(`drizzle/migrations/${phone.tag}.sql`, "utf8");
const resumeSql = readFileSync(`drizzle/migrations/${resume.tag}.sql`, "utf8");
assert.match(phoneSql, /resolve_waitlist_phone_conflict/);
assert.doesNotMatch(resumeSql, /resolve_waitlist_phone_conflict/);
assert.match(resumeSql, /CREATE TABLE public\.application_recovery_attempts/);
assert.match(resumeSql, /reserve_application_recovery/);
assert.match(resumeSql, /finish_application_recovery/);
assert.match(resumeSql, /resolve_application_identity_review/);
assert.doesNotMatch(resumeSql, /CREATE OR REPLACE|DROP (?:TABLE|FUNCTION|TRIGGER)/i);

console.log("PASS 0022 phone conflict kept; 0023 application resume ordered after it; SQL not executed");
