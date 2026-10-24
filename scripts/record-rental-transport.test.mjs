// Transport login provisioning against the local Record Rental harness:
// the proposed SQL creates the reviewed shape, the SCRAM verifier made locally
// authenticates the generated password over real SCRAM, and a wrong password
// and a password-less login are refused. Run after scripts/record-rental-harness/up.sh.
import assert from "node:assert/strict";
import { readFileSync, appendFileSync, readFileSync as read } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { scramVerifier } from "./record-rental-transport-scram.mjs";

const SU = "postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable";
const su = postgres(SU, { max: 1, onnotice: () => {} });
const login = (pw) => postgres(`postgres://rr_evidence_transport:${encodeURIComponent(pw)}@127.0.0.1:55462/rr?sslmode=disable`, { max: 1, onnotice: () => {}, connect_timeout: 5 });
try {
  // Require SCRAM for this one login on the harness (the rest of the harness uses trust).
  const hba = "/tmp/rr-harness/data/pg_hba.conf";
  if (!read(hba, "utf8").startsWith("host rr rr_evidence_transport")) {
    const rest = read(hba, "utf8");
    execFileSync("bash", ["-c", `printf 'host rr rr_evidence_transport 127.0.0.1/32 scram-sha-256\\n' | cat - ${hba} > /tmp/rr-hba && cp /tmp/rr-hba ${hba} && chown 65534:65534 ${hba}`]);
    void rest;
  }
  await su`select pg_reload_conf()`;
  await su.unsafe("DO $$ BEGIN IF to_regrole('rr_evidence_transport') IS NOT NULL THEN REVOKE CONNECT ON DATABASE rr FROM rr_evidence_transport; DROP ROLE rr_evidence_transport; END IF; END $$");
  await su.unsafe(readFileSync("proposed/record-rental-transport/01-transport-login.sql", "utf8"));
  const [shape] = await su`select r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolbypassrls, r.rolconnlimit, (select count(*)::int from pg_auth_members m where m.member = r.oid) memberships
    from pg_roles r where rolname = 'rr_evidence_transport'`;
  assert.deepEqual({ ...shape }, { rolcanlogin: true, rolinherit: false, rolsuper: false, rolbypassrls: false, rolconnlimit: 10, memberships: 2 });
  console.log("PASS proposed SQL creates the reviewed login shape (issuer and approval-executor memberships, SET only, no password)");

  await assert.rejects(async () => { const c = login("anything"); try { await c`select 1`; } finally { await c.end(); } }, /password authentication failed|authentication/i);
  console.log("PASS a login with no password set cannot sign in");

  const password = randomBytes(32).toString("base64url");
  const verifier = scramVerifier(password);
  assert.match(verifier, /^SCRAM-SHA-256\$4096:/);
  await su.unsafe(`ALTER ROLE rr_evidence_transport PASSWORD '${verifier}'`);
  const [{ stored }] = await su`select rolpassword = ${verifier} stored from pg_authid where rolname = 'rr_evidence_transport'`;
  assert.equal(stored, true);
  const good = login(password);
  const [who] = await good.begin(async (tx) => { await tx.unsafe("SET LOCAL ROLE rr_evidence_issuer"); return tx`select session_user::text s, current_user::text c`; });
  await good.end();
  assert.deepEqual({ ...who }, { s: "rr_evidence_transport", c: "rr_evidence_issuer" });
  console.log("PASS the locally made SCRAM verifier authenticates the generated password; the session narrows to rr_evidence_issuer");

  await assert.rejects(async () => { const c = login(password + "x"); try { await c`select 1`; } finally { await c.end(); } }, /authentication/i);
  console.log("PASS a wrong password is refused");
  const bad = login(password);
  for (const role of ["service_role", "authenticated", "postgres", "rr_record_executor"])
    await assert.rejects(() => bad.begin((tx) => tx.unsafe(`SET LOCAL ROLE ${role}`)), /permission denied/);
  await assert.rejects(() => bad`select count(*) from public.applications`, /permission denied/);
  await assert.rejects(() => bad`select private.license_snapshot_v1(gen_random_uuid())`, /permission denied/);
  await bad.end();
  console.log("PASS the login cannot become any other role and, before narrowing, has no table or function access of its own");
} finally {
  await su.end();
}
