// S1 production-parity rehearsal (local only, 127.0.0.1:55462): PostgreSQL 17.6, en_US.UTF-8,
// baseline + Security 0031, with public.applications ACL made identical to production
// (acl_items md5 176dd288c947a0deff8c7a7626d8b1df, 150 items, incl. sandbox_exec=ar BYPASSRLS LOGIN).
// Test copies change only the package's profile line (database + system identifier), as the S1 suite does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import postgres from "/home/user/real-rentals/node_modules/postgres/src/index.js";

const DIR = "/home/user/wt-s1/proposed/security-s1";
const URL = "postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable";
assert.ok(URL.includes("127.0.0.1"));
const db = postgres(URL, { max: 1, onnotice: () => {} });
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: parity\n-- date: 2026-10-25T00:00:00.000Z";
const PROD_PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';
const PROD_ACL_MD5 = "176dd288c947a0deff8c7a7626d8b1df";
const PROD_FINGERPRINT = "67726740be2e6204dac8cc2b6c3ff13e025430cb729bb4f5790f49cf85ef9603";
const results: Record<string, unknown> = {};
const step = (k: string, v: unknown) => { results[k] = v; console.log(`${k}: ${JSON.stringify(v)}`); };

const q1 = async (sql: string) => Object.values((await db.unsafe(sql))[0])[0];
const ro = async (file: string) => {
  let out: any;
  await db.begin("READ ONLY", async (tx: any) => { const [r] = await tx.unsafe(readFileSync(join(DIR, file), "utf8").replace(/;\s*$/, "")); out = Object.values(r)[0]; });
  return out;
};
const testCopy = async (file: string) => {
  const pkg = readFileSync(join(DIR, file), "utf8");
  const sysid = String(await q1("SELECT system_identifier::text FROM pg_control_system()"));
  const lines = pkg.split("\n");
  const i = lines.findIndex((l) => l.startsWith(" profile jsonb := "));
  const before = lines[i];
  lines[i] = before.replace(PROD_PROFILE, `"database": "rr", "system_identifier": "${sysid}"`);
  assert.notEqual(lines[i], before);
  assert.equal(lines.filter((l, k) => l !== pkg.split("\n")[k]).length, 1);
  const tmp = mkdtempSync("/tmp/s1parity-");
  const p = join(tmp, file); writeFileSync(p, lines.join("\n"));
  const guard = execFileSync("python3", ["-I", "/home/user/wt-s1/scripts/sql-guard/gen-guard3.py", p]);
  return guard.toString("utf8") + lines.join("\n");
};
const send = async (text: string) => { try { await db.unsafe(text + TRAILER); return "ok"; } catch (e: any) { return `${e.code ?? ""} ${e.message}`; } };
const asRole = async (role: string, sql: string, claims?: object) => {
  try {
    await db.begin(async (tx: any) => {
      if (claims) await tx.unsafe(`SELECT set_config('request.jwt.claims', '${JSON.stringify(claims)}', true)`);
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await tx.unsafe(sql);
      throw Object.assign(new Error("ROLLBACK_OK"), { code: "ROLLBACK_OK" });
    });
    return "unreachable";
  } catch (e: any) { return e.code === "ROLLBACK_OK" ? "allowed" : `${e.code} ${e.message}`; }
};

try {
  const pre = await ro("preflight-readonly.sql");
  step("pre.all_gates", pre.all_gates);
  step("pre.gates", pre.gates);
  step("pre.acl_items_md5_equals_production", pre.facts.acl_items_md5 === PROD_ACL_MD5);
  step("pre.version_collation", [await q1("SELECT current_setting('server_version')"), pre.target.datcollate]);
  step("pre.fingerprint_equals_production", pre.fingerprint_sha256 === PROD_FINGERPRINT);
  assert.equal(pre.all_gates, true);

  const coord = { role: "authenticated", sub: "00000000-0000-4000-8000-00000000c001" };
  const before = {
    update_status: await asRole("authenticated", "UPDATE public.applications SET status = 'closed'", coord),
    insert_approved: await asRole("authenticated", "INSERT INTO public.applications(full_name,email,phone,status) VALUES ('Syn','syn@example.test','0000000','approved')", coord),
    sandbox_insert_approved: await asRole("sandbox_exec", "INSERT INTO public.applications(full_name,email,phone,status) VALUES ('Syn','syn@example.test','0000000','approved')"),
  };
  step("before_install", before);

  const req = await testCopy("s1_application_write_guard.sql");
  const tampered = req.replace("DROP", "DROP ").replace("REVOKE", "REVOKE ");
  step("tampered_request", await send(tampered));
  step("install", await send(req));
  const ver = await ro("verify-after-readonly.sql");
  step("verify.all_gates", ver.all_gates);
  step("verify.gates", ver.gates);

  const after = {
    update_status: await asRole("authenticated", "UPDATE public.applications SET status = 'closed'", coord),
    insert_approved: await asRole("authenticated", "INSERT INTO public.applications(full_name,email,phone,status) VALUES ('Syn','syn@example.test','0000000','approved')", coord),
    insert_form_partial: await asRole("authenticated", "INSERT INTO public.applications(full_name,email,phone) VALUES ('Syn','syn@example.test','0000000')", coord),
    anon_form_insert: await asRole("anon", "INSERT INTO public.applications(full_name,email,phone) VALUES ('Syn','syn@example.test','0000000')"),
    service_role_status: await asRole("service_role", "UPDATE public.applications SET status = status WHERE false"),
    sandbox_insert_approved: await asRole("sandbox_exec", "INSERT INTO public.applications(full_name,email,phone,status) VALUES ('Syn','syn@example.test','0000000','approved')"),
  };
  step("after_install", after);
  step("sandbox_exec_acl_after", await q1("SELECT relacl::text FROM pg_class WHERE oid='public.applications'::regclass"));
  step("replay_install", await send(req));

  const rb = await testCopy("rollback.sql");
  step("rollback", await send(rb));
  const post = await ro("preflight-readonly.sql");
  step("post_rollback.acl_items_md5_equals_production", post.facts.acl_items_md5 === PROD_ACL_MD5);
  step("post_rollback.fingerprint_equals_pre", post.fingerprint_sha256 === pre.fingerprint_sha256);
  step("post_rollback.guard_absent", post.installed);
  step("post_rollback.status_update_again", await asRole("authenticated", "UPDATE public.applications SET status = 'closed'", coord));
  writeFileSync("/tmp/claude-0/-home-user-real-rentals/ea6e7b6c-2589-5533-8dfa-3369891126ce/scratchpad/s1-parity-results.json", JSON.stringify(results, null, 1));
} finally {
  await db.end();
}
