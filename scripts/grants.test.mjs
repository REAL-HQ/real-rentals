/**
 * Do the database's column grants still match what we intended?
 *
 * Two halves. The source half always runs: the migration's exclusion list and
 * the declared intent must agree, so nobody can quietly widen one without the
 * other. The live half needs a database and runs only when one is reachable —
 * it is the half that catches a NEW column whose grant nobody thought about,
 * which no amount of reading the repo can tell you.
 *
 * Give it a connection with:  SUPABASE_DB_URL=postgres://... npm run test:grants
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const intent = JSON.parse(readFileSync("scripts/application-columns.json", "utf8"));
const serverOwned = new Set(intent.serverOwned);

console.log("THE MIGRATION AND THE DECLARED INTENT AGREE");
{
  const sql = readFileSync("supabase/migrations/20260927010000_ai_columns_service_role_only.sql", "utf8");
  const m = sql.match(/column_name NOT IN \(([^)]*)\)/);
  ok(Boolean(m), "the migration states an exclusion list");
  const excluded = new Set((m?.[1] ?? "").match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) ?? []);
  ok(excluded.size === serverOwned.size && [...serverOwned].every((c) => excluded.has(c)),
     `the list matches application-columns.json (${[...excluded].join(", ")})`);
  ok(/REVOKE UPDATE ON public\.applications FROM authenticated/.test(sql),
     "table-wide UPDATE is revoked from authenticated");
  ok(/GRANT UPDATE \(%s\) ON public\.applications TO authenticated/.test(sql),
     "  and replaced by an explicit column list");
  ok(/REVOKE UPDATE ON public\.applications FROM anon/.test(sql), "anon holds no UPDATE at all");
}

console.log("\nTHE LIVE DATABASE MATCHES THE INTENT");
const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.log("  SKIP  no SUPABASE_DB_URL in the environment.");
  console.log("        Run this against the database before shipping a migration that");
  console.log("        adds an applications column; the source half above cannot see");
  console.log("        a column that exists only in the database.");
} else {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const all = (await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='applications'`,
  )).rows.map((r) => r.column_name);
  const granted = new Set((await client.query(
    `SELECT column_name FROM information_schema.column_privileges
      WHERE table_schema='public' AND table_name='applications'
        AND grantee='authenticated' AND privilege_type='UPDATE'`,
  )).rows.map((r) => r.column_name));
  await client.end();

  const wronglyWritable = [...serverOwned].filter((c) => granted.has(c));
  ok(wronglyWritable.length === 0,
     `no server-owned column is browser-writable (${wronglyWritable.join(", ") || "none"})`);
  const missingGrant = all.filter((c) => !serverOwned.has(c) && !granted.has(c));
  ok(missingGrant.length === 0,
     `every intended-editable column has its grant (${missingGrant.join(", ") || "none missing"})`);
  if (missingGrant.length) {
    console.log("        These are new columns. Decide: server-owned (add to");
    console.log("        application-columns.json and the migration) or editable (extend the grant).");
  }
}

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
