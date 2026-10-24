// Forward-fix route rehearsal, local harness only, synthetic data only. Installed M2 (all 29 steps)
// with a seeded verified approval (approval identity, approval operation, approval audit rows, bound
// documents, content bindings). Every request is built by scripts/m2-forward-fix.mjs and sent as the
// Management API delivers it (bytes plus the API trailer). Proves:
//   - the lint refuses a fix that writes data;
//   - a tampered request is refused by guard v3;
//   - a non-boundary function fix applies, leaves every row of every table, the evidence
//     fingerprint, Security 0031 and every verify result unchanged;
//   - a boundary-function change is refused unless the owner names the function;
//   - a named boundary fix that keeps every refusal code applies with all data unchanged;
//   - a named fix that removes the verified-identity refusal is refused (RRFIX_REFUSAL_REMOVED);
//   - every refusal leaves the database exactly as it was.
// Run: bash scripts/record-rental-harness/up.sh && bash scripts/record-rental-harness/seed.sh && bun scripts/m2-forward-fix.test.ts
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

const REF = process.env.M2_PACKET_REF ?? "origin/review/m2-packet-29d47ee3";
const db = postgres("postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable", { max: 1, onnotice: () => {} });
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: harness\n-- date: 2026-10-24T00:00:00.000Z";
const SAMPLES = "proposed/m2-window2/forward-fix-samples";
const out = mkdtempSync(join(tmpdir(), "rr-fix-"));
let checks = 0;
const pass = (s: string) => { checks++; console.log(`PASS ${s}`); };
const send = async (text: string) => { try { await db.unsafe(text + TRAILER); return "ok"; } catch (e: any) { return String(e.message); } };
const build = (sample: string, allow?: string) => {
  const args = ["scripts/m2-forward-fix.mjs", `${SAMPLES}/${sample}.sql`, out, ...(allow ? ["--allow-boundary", allow] : [])];
  const r = spawnSync("node", args, { encoding: "utf8" });
  return { status: r.status, text: r.status === 0 ? readFileSync(join(out, `${sample}.request.sql`), "utf8") : "", err: r.stderr };
};
const fpText = readFileSync("proposed/m2-window2/evidence-fingerprint-readonly.sql", "utf8").replace(/;\s*$/, "");
const fingerprint = async () => (await db.unsafe(fpText))[0].evidence_fingerprint;
/** Every row of every table in public, private, storage and auth: count and md5 per table. */
const allRows = async () => {
  const tables = await db`select n.nspname s, c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and n.nspname in ('public','private','storage','auth') order by 1, 2`;
  const res: Record<string, string> = {};
  for (const { s, t } of tables) {
    const [r] = await db.unsafe(`select count(*)::text || ':' || coalesce(md5(string_agg(x::text, E'\\n' order by x::text)), '') h from "${s}"."${t}" x`);
    res[`${s}.${t}`] = r.h;
  }
  return res;
};
const fnDef = async (sig: string) => (await db.unsafe(`select md5(pg_get_functiondef('${sig}'::regprocedure)) d`))[0].d;
/** Every step verify's result (each is written for the moment after its own step, so on a full
 *  install some are legitimately false); the vector must not change, and step 29's verify and
 *  no-executor-create must be true. */
const verifyVector = async () => {
  const manifest = JSON.parse(execFileSync("git", ["show", `${REF}:proposed/rehearsal/manifest.json`], { encoding: "utf8" }));
  const v: Record<string, unknown> = {};
  for (const e of manifest) if (e.kind === "verify" && e.step) {
    const q = execFileSync("git", ["show", `${REF}:${e.path}`], { encoding: "utf8" }).replace(/;\s*$/, "");
    try { v[e.step] = Object.values((await db.unsafe(q))[0])[0]; } catch (err: any) { v[e.step] = `error: ${err.message}`; }
  }
  const nec = execFileSync("git", ["show", `${REF}:proposed/m2-verify/no-executor-create.sql`], { encoding: "utf8" }).replace(/;\s*$/, "");
  v["no-executor-create"] = Object.values((await db.unsafe(nec))[0])[0];
  assert.equal(v["29"], true, "step 29 verify"); assert.equal(v["no-executor-create"], true, "no-executor-create");
  return v;
};

try {
  const ev = await fingerprint();
  assert.equal(ev.identity_reviews[0], 2); assert.equal(ev.approval_operations[0], 1); assert.ok(ev.approval_audit[0] >= 2);
  pass("seeded state: verified approval identity, approval operation and approval audit rows exist");

  const dw = build("sample-data-write");
  assert.notEqual(dw.status, 0); assert.match(dw.err, /statement not allowed: UPDATE public\.audit_log/);
  pass("lint refuses a fix containing a data statement (audit_log UPDATE); no request is produced");

  const rows0 = await allRows(); const fp0 = await fingerprint(); const ver0 = await verifyVector();
  const nb = build("sample-non-boundary");
  assert.equal(nb.status, 0);
  assert.match(await send(nb.text.replace("unchanged logic", "unchanged  logic")), /RRGUARD_BYTES_MISMATCH/);
  assert.deepEqual(await allRows(), rows0);
  pass("a one-byte change to a fix request is refused by guard v3; nothing changes");

  const before = await fnDef("private.record_issuer_scope_v2(uuid)");
  assert.equal(await send(nb.text), "ok");
  assert.notEqual(await fnDef("private.record_issuer_scope_v2(uuid)"), before);
  assert.deepEqual(await allRows(), rows0); assert.deepEqual(await fingerprint(), fp0);
  assert.deepEqual(await verifyVector(), ver0);
  pass(`non-boundary fix applied: every row of every table, the evidence fingerprint and Security 0031 unchanged; all ${Object.keys(ver0).length} verify results unchanged, step 29 and no-executor-create true`);

  const SIG = "private.approval_validate(_id uuid)";
  const valBefore = await fnDef("private.approval_validate(uuid)");
  const unnamed = build("sample-boundary-timeout");
  assert.equal(unnamed.status, 0);
  assert.match(await send(unnamed.text), /RRFIX_EVIDENCE_CHANGED/);
  assert.equal(await fnDef("private.approval_validate(uuid)"), valBefore); assert.deepEqual(await allRows(), rows0);
  pass("a change to an approval-boundary function the owner did not name is refused (RRFIX_EVIDENCE_CHANGED); nothing changes");

  const bypassUnnamed = build("sample-bypass-identity");
  assert.match(await send(bypassUnnamed.text), /RRFIX_EVIDENCE_CHANGED/);
  const bypassNamed = build("sample-bypass-identity", SIG);
  assert.equal(bypassNamed.status, 0);
  assert.match(await send(bypassNamed.text), /RRFIX_REFUSAL_REMOVED/);
  assert.equal(await fnDef("private.approval_validate(uuid)"), valBefore); assert.deepEqual(await allRows(), rows0);
  pass("removing the verified-identity requirement is refused even when the function is named (RRFIX_REFUSAL_REMOVED); nothing changes");

  const named = build("sample-boundary-timeout", SIG);
  assert.equal(named.status, 0);
  assert.equal(await send(named.text), "ok");
  assert.notEqual(await fnDef("private.approval_validate(uuid)"), valBefore);
  const fp1 = await fingerprint();
  for (const k of Object.keys(fp0)) if (k !== "boundary_functions") assert.deepEqual(fp1[k], fp0[k], k);
  assert.notDeepEqual(fp1.boundary_functions, fp0.boundary_functions);
  assert.deepEqual(await allRows(), rows0);
  assert.deepEqual(await verifyVector(), ver0);
  pass("a named boundary fix that keeps every refusal code applies; all rows, identity evidence, approval audit, bindings, 0031 and verifies unchanged; only the named definition differs");
  console.log(`\nm2-forward-fix: ${checks} checks passed`);
} finally {
  await db.end();
}
