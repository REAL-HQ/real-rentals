// M2 Window 1 and Window 2 played exactly as production would receive them, on the local
// harness only: the baseline plus Security 0031 (production's state since 2026-10-24), then
// each write as the committed guarded request in proposed/m2-guarded/ (reviewed guard v3 +
// unchanged packet file) with the Management API trailer appended, each read-only verify as
// its file, and the stand-down assertion after each window. A tampered request must be
// refused before anything runs, and the 0031 policies must be untouched at the end.
// Run: RR_HARNESS_LAST_ORD=143 bash scripts/record-rental-harness/up.sh && bun scripts/m2-guarded-window.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const REF = process.env.M2_PACKET_REF ?? "origin/review/m2-packet-29d47ee3";
const db = postgres("postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable", { max: 1, onnotice: () => {} });
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: harness\n-- date: 2026-10-24T00:00:00.000Z";
const show = (p: string) => execFileSync("git", ["show", `${REF}:${p}`], { encoding: "utf8" });
let checks = 0;
const pass = (s: string) => { checks++; console.log(`PASS ${s}`); };
const one = async (text: string) => { const rows = await db.unsafe(text.replace(/;\s*$/, "")); return Object.values(rows[0] ?? {})[0]; };
const send = async (text: string) => { try { await db.unsafe(text + TRAILER); return "ok"; } catch (e: any) { return String(e.message); } };
const policies0031 = () => db`select md5(string_agg(concat_ws('|',schemaname,tablename,policyname,permissive,roles::text,cmd,qual), E'\n' order by policyname)) h, count(*)::int n
  from pg_policies where policyname like 'coordinator\_%\_containment'`.then((r) => r[0]);

try {
  execFileSync("node", ["scripts/m2-guarded-requests.mjs", "--check"], { stdio: "pipe" });
  pass("committed guarded requests are reproduced byte for byte from the reviewed packet ref");
  const before = await policies0031();
  const [{ m2 }] = await db`select to_regrole('rr_approval_executor') is not null as m2`;
  assert.equal(before.n, 5); assert.equal(m2, false);
  pass("starting state matches production: baseline + Security 0031 (5 policies), no M2 role");

  const manifest = JSON.parse(show("proposed/rehearsal/manifest.json"));
  const steps = new Map<number, string>();
  for (const line of readFileSync("proposed/m2-guarded/SHA256SUMS", "utf8").trim().split("\n")) {
    const name = line.split("  ")[1]; steps.set(Number(name.slice(0, 2)), name);
  }
  let writeNo = 0, verifies = 0;
  const run = async (e: any) => {
    if (e.kind === "packet") {
      const name = steps.get(++writeNo)!;
      assert.ok(name.endsWith(`-step-${e.step}.sql`), `run order ${name} vs step ${e.step}`);
      const req = readFileSync(`proposed/m2-guarded/${name}`, "utf8");
      if (e.step === "3-pre") {
        const tampered = req.replace("GRANT", "GRANT ");
        assert.notEqual(tampered, req);
        const r = await send(tampered);
        assert.match(r, /RRGUARD_BYTES_MISMATCH/);
        assert.equal((await db`select count(*)::int n from pg_auth_members m join pg_roles r on r.oid = m.roleid where r.rolname = 'rr_approval_executor'`)[0].n, 0);
        pass("a one-byte change to a window file is refused by the guard before anything runs");
      }
      const r = await send(req);
      assert.equal(r, "ok", `${name}: ${r}`);
    } else if (e.kind === "verify") {
      assert.equal(await one(show(e.path)), true, `${e.path} must return t`); verifies++;
    } else if (e.path.endsWith("m2-preflight.sql")) {
      const rows = await db.unsafe(`SELECT check_name, actual FROM (${show(e.path).replace(/;\s*$/, "")}) q WHERE ok IS NOT TRUE`);
      assert.equal(rows.length, 0, `preflight: ${rows.map((x: any) => `${x.check_name}=${x.actual}`).join("; ")}`);
      pass("M2 preflight: zero failing checks with Security 0031 installed");
    }
  };
  const byOrd = (o: number) => manifest.find((e: any) => e.ord === o);
  // Window 1: preflight, steps 1-2 with verifies, the backfill gate report, stand-down.
  for (let o = 144; o <= 148; o++) await run(byOrd(o));
  const gate = await db.unsafe(show("proposed/backfill-document-content-sha.sql").replace(/;\s*$/, ""));
  const text = JSON.stringify(gate);
  assert.ok(!/"missing":[1-9]|"mismatched":[1-9]/.test(text), `gate report ${text}`);
  assert.equal(await one(show("proposed/m2-verify/no-executor-create.sql")), true);
  pass(`Window 1 through guarded requests: steps 1-2 installed, verifies true, gate report clean, stand-down true`);
  // Window 2: 3-pre, 3, 3-post, steps 4-29, each verify, stand-down.
  for (const e of manifest) if (e.ord >= 149 && e.ord <= 204 && e.kind !== "rollback") await run(e);
  assert.equal(await one(show("proposed/m2-verify/no-executor-create.sql")), true);
  pass(`Window 2 through guarded requests: ${writeNo} guarded writes in total, ${verifies} verifies true, stand-down true`);
  const after = await policies0031();
  assert.deepEqual(after, before);
  pass("Security 0031 policies unchanged by the whole M2 install");
  console.log(`\nm2-guarded-window: ${checks} checks passed`);
} finally {
  await db.end();
}
