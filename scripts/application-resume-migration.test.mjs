/** Read-only migration ordering/compatibility checks. No database connection or SQL execution. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";

// Reviewed main snapshot containing the user-confirmed applied Phase B migration.
const appliedRef = "cfcc0cb";
const show = (path) => execFileSync("git", ["show", `${appliedRef}:${path}`]);
const dir = "drizzle/migrations";
const journal = JSON.parse(readFileSync(`${dir}/meta/_journal.json`, "utf8"));
const applied = JSON.parse(show(`${dir}/meta/_journal.json`));
assert.deepEqual(journal.entries.slice(0, -1), applied.entries);
for (const entry of applied.entries) {
  const file = `${dir}/${entry.tag}.sql`;
  assert.deepEqual(readFileSync(file), show(file));
  const snapshot = `${dir}/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`;
  assert.deepEqual(readFileSync(snapshot), show(snapshot));
}
const last = journal.entries.at(-1);
assert.equal(last.idx, 22);
assert.equal(last.tag, "0022_application_resume_atomic_security");
assert.ok(last.when > applied.entries.at(-1).when);
assert.equal(
  new Set(journal.entries.map((entry) => entry.tag.slice(0, 4))).size,
  journal.entries.length,
);
const oldSnapshot = JSON.parse(readFileSync(`${dir}/meta/0021_snapshot.json`));
const newSnapshot = JSON.parse(readFileSync(`${dir}/meta/0022_snapshot.json`));
assert.equal(newSnapshot.prevId, oldSnapshot.id);
assert.notEqual(newSnapshot.id, oldSnapshot.id);
const sqlText = readFileSync(`${dir}/${last.tag}.sql`, "utf8");
assert.deepEqual(
  Buffer.from(sqlText),
  execFileSync("git", [
    "show",
    "65d2cb1:drizzle/migrations/0021_application_resume_atomic_security.sql",
  ]),
);
console.log(
  "PASS applied migration SQL, snapshots and journal preserved; unique ordered 0022; SQL unchanged",
);

// Exercise the installed Drizzle selection algorithm with an in-memory session.
// Capturing a statement here does NOT execute it or apply a migration.
const dialect = new PgDialect();
const captured = [];
const session = {
  all: async () => [{ created_at: applied.entries.at(-1).when }],
  execute: async (query) => {
    const { sql } = dialect.sqlToQuery(query);
    return sql.startsWith("select id, hash") ? [{ created_at: applied.entries.at(-1).when }] : [];
  },
  transaction: async (run) =>
    run({ execute: async (query) => captured.push(dialect.sqlToQuery(query)) }),
};
await dialect.migrate(readMigrationFiles({ migrationsFolder: dir }), session, {});
assert.equal(captured.length, 2); // Security SQL + its journal insert, never historical migrations.
assert.equal(captured[0].sql, sqlText);
assert.equal(captured[1].params[1], last.when);
console.log("PASS actual Drizzle ordering selects only security 0022 after applied Phase B 0021");
assert.ok(
  !/CREATE OR REPLACE|DROP (?:TABLE|FUNCTION|TRIGGER)|ALTER TABLE public\.(?:applications|rentals|driver_screenings)/i.test(
    sqlText,
  ),
);
assert.ok(!/SET\s+status\s*=\s*'active'/i.test(sqlText));
console.log(
  "PASS additive security SQL does not replace existing objects or change application/rental status guards",
);
