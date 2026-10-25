/**
 * Reminder scheduler fix v1 (proposed/reminder-scheduler-fix), on a disposable PostgreSQL 17.
 *
 * Opt-in (npm run test:reminder-scheduler-fix): initdb on 127.0.0.1:55552 as uid 65534,
 * replays this tree's migrations, then stands in for the two hosted extensions the package
 * touches: a cron schema (job, job_run_details, alter_job) and net.http_post, which records
 * the call instead of making it. No network, no hosted database, torn down at the end.
 *
 * The cron.job rows are the production commands byte for byte (md5-checked below), so the
 * package's drift gates are exercised against the real text. Test copies change only the
 * package's profile line (database + system identifier), as the S1 suite does.
 *
 * Not reproducible locally: hosted privileges (postgres is superuser here) and pg_cron's own
 * alter_job ownership check; the stub enforces job owner = current_user.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const PG = "/opt/pg17/bin";
const PORT = 55552;
const D = "/tmp/rr-cronfix-pg";
const B = `postgresql://postgres@127.0.0.1:${PORT}`;
const U = `${B}/postgres?sslmode=disable`;
const PKG = "proposed/reminder-scheduler-fix";
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: test\n-- date: 2026-10-25T00:00:00.000Z";
const PROD_PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';
const md5 = (s) => createHash("md5").update(s).digest("hex");
const asNobody = (bin, args, opts = {}) =>
  execFileSync("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "env", `HOME=${D}`, `${PG}/${bin}`, ...args], { stdio: "pipe", ...opts });
const psql = (sql, { tx = false } = {}) =>
  execFileSync("psql", [U, "-qAtX", "-v", "ON_ERROR_STOP=1", ...(tx ? ["-1"] : []), "-c", sql], { encoding: "utf8" }).trim();
const send = (text) => {
  // One simple-query message, one implicit transaction: what the Management API sends (psql -c, not stdin,
  // which would split the statements and hide the package from the guard's current_query()).
  try { execFileSync("psql", [U, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", text + TRAILER], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return "ok"; }
  catch (e) { return String(e.stderr || e.message).match(/ERROR:\s+([^\n]+)/)?.[1] ?? String(e.stderr); }
};

let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; console.log("PASS", name); };

/** Production commands (cron.job, 2026-10-25), reproduced exactly; md5s asserted against production values. */
const cmd = (name, fn) => `\n  SELECT ${fn}(\n    url := 'https://drivereal.com/api/public/cron/${name}',\n    headers := jsonb_build_object(\n      'Content-Type', 'application/json',\n      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = '${name}')\n    ),\n    body := '{}'::jsonb\n  ) AS request_id;\n  `;
const JOBS = [
  [2, "wizard-recovery-hourly", "15 * * * *", cmd("wizard-recovery", "extensions.http_post")],
  [3, "ops-reminders-daily", "30 13 * * *", cmd("ops-reminders", "extensions.http_post")],
  [4, "automations-every-5-min", "*/5 * * * *", cmd("automations", "net.http_post")],
  [5, "late-fees-daily", "30 11 * * *", cmd("late-fees", "net.http_post")],
  [6, "esign-archive-retry-hourly", "45 * * * *", cmd("esign-archive-retry", "net.http_post")],
];
assert.equal(md5(JOBS[0][3]), "1c830e7409ddcb0275cea04ffcca74c9");
assert.equal(md5(JOBS[1][3]), "7a6594649bd441f8ecb8baf8fc529368");
assert.equal(md5(JOBS[2][3]), "454777d5c3981594314497dc1017f1b1");
assert.equal(md5(cmd("wizard-recovery", "net.http_post")), "478d975efc9c11c5ad5e6c1fe7769ece");

const STUBS = `
-- Replace the eSign harness's minimal cron/net stubs with ones that keep state.
DROP SCHEMA IF EXISTS cron CASCADE; DROP SCHEMA IF EXISTS net CASCADE;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigint PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
  nodename text NOT NULL DEFAULT 'localhost', nodeport int NOT NULL DEFAULT 5432, database text NOT NULL DEFAULT 'postgres',
  username text NOT NULL DEFAULT current_user, active boolean NOT NULL DEFAULT true, jobname text);
CREATE TABLE IF NOT EXISTS cron.job_run_details (jobid bigint, runid bigserial, start_time timestamptz, status text, return_message text);
CREATE SEQUENCE IF NOT EXISTS cron.jobid_seq START 100;
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
 $$ INSERT INTO cron.job(jobid, schedule, command, jobname) VALUES (nextval('cron.jobid_seq'), schedule, command, job_name)
    ON CONFLICT DO NOTHING RETURNING jobid $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = job_id RETURNING true $$;
-- pg_cron 1.6 signature; like the real one, only the job's owner may alter it.
CREATE OR REPLACE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobid = job_id) THEN RAISE EXCEPTION 'Job % does not exist', job_id; END IF;
  IF (SELECT j.username FROM cron.job j WHERE j.jobid = job_id) <> current_user THEN RAISE EXCEPTION 'permission denied for job %', job_id; END IF;
  UPDATE cron.job j SET schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command),
    database = coalesce(alter_job.database, j.database), username = coalesce(alter_job.username, j.username),
    active = coalesce(alter_job.active, j.active) WHERE j.jobid = job_id;
END $$;
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.calls (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb);
-- pg_net 0.20 signature; records the request instead of sending it.
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls(url, headers, body) VALUES (url, headers, body) RETURNING id $$;
CREATE TABLE IF NOT EXISTS net._http_response (id bigint, status_code int, content text, created timestamptz DEFAULT now(), error_msg text);
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.cron_tokens (name text PRIMARY KEY, token text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
`;

function up() {
  rmSync(D, { recursive: true, force: true });
  execFileSync("mkdir", ["-p", D]); execFileSync("chown", ["65534:65534", D]);
  asNobody("initdb", ["-D", `${D}/data`, "-U", "postgres", "-A", "trust", "--no-sync"]);
  asNobody("pg_ctl", ["-D", `${D}/data`, "-o", `-p ${PORT} -k ${D} -c listen_addresses=127.0.0.1`, "-l", `${D}/log`, "-w", "start"]);
  execFileSync("psql", [U, "-qX", "-f", "scripts/esign-harness/stubs.sql"], { stdio: "ignore" });
  psql("alter database postgres set search_path=public,extensions");
  psql(STUBS);
  let skipped = 0;
  const files = [...readdirSync("supabase/migrations").map((f) => `supabase/migrations/${f}`), ...readdirSync("drizzle/migrations").map((f) => `drizzle/migrations/${f}`)]
    .filter((f) => f.endsWith(".sql")).sort((a, b) => (a.startsWith("supabase") === b.startsWith("supabase") ? a.localeCompare(b) : a.startsWith("supabase") ? -1 : 1));
  for (const f of files) {
    const sql = readFileSync(f, "utf8").replace(/^\s*create extension[^;]*(pg_net|pg_cron|pg_graphql|supabase_vault|pgsodium)[^;]*;/gim, "");
    try { execFileSync("psql", [U, "-qX", "-v", "ON_ERROR_STOP=1", "-1"], { input: sql, stdio: ["pipe", "ignore", "ignore"] }); } catch { skipped++; }
  }
  // Production cron state, exactly.
  psql(`DELETE FROM cron.job; INSERT INTO private.cron_tokens(name, token) VALUES ('wizard-recovery','tok-wizard-recovery'),('ops-reminders','tok-ops'),('automations','tok-auto') ON CONFLICT (name) DO UPDATE SET token = EXCLUDED.token;`);
  for (const [id, name, sched, command] of JOBS) {
    psql(`INSERT INTO cron.job(jobid, jobname, schedule, command, username, database, active) VALUES (${id}, '${name}', '${sched}', $c$${command}$c$, 'postgres', 'postgres', true)`);
  }
  return skipped;
}
function down() {
  try { asNobody("pg_ctl", ["-D", `${D}/data`, "-m", "fast", "stop"]); } catch {}
  rmSync(D, { recursive: true, force: true });
}

const sysid = () => psql("SELECT system_identifier::text FROM pg_control_system()");
function testCopy(file) {
  const pkg = readFileSync(join(PKG, file), "utf8");
  const lines = pkg.split("\n");
  const i = lines.findIndex((l) => l.startsWith(" profile jsonb := "));
  const changed = lines[i].replace(PROD_PROFILE, `"database": "postgres", "system_identifier": "${sysid()}"`);
  assert.notEqual(changed, lines[i]); lines[i] = changed;
  const dir = mkdtempSync(join(tmpdir(), "rr-cronfix-")); const p = join(dir, file);
  writeFileSync(p, lines.join("\n"));
  return execFileSync("python3", ["-I", "scripts/sql-guard/gen-guard3.py", p], { encoding: "utf8" }) + lines.join("\n");
}
const ro = (file) => JSON.parse(psql(`BEGIN READ ONLY; ${readFileSync(join(PKG, file), "utf8").replace(/;\s*$/, "")}; COMMIT;`).split("\n").find((l) => l.startsWith("{")));
const jobMd5 = (name) => psql(`SELECT md5(command) FROM cron.job WHERE jobname = '${name}'`);
const otherJobs = () => psql("SELECT string_agg(jobid||':'||md5(command)||':'||schedule||':'||active, ',' ORDER BY jobid) FROM cron.job WHERE jobid <> 2");
const runJob = (name) => { try { psql(`DO $r$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = '${name}'); END $r$`); return "ok"; } catch (e) { return String(e.stderr || e.message); } };

// Synthetic applications, one per filter edge. Only the eligible ones should count.
const SEED = [
  ["h24-eligible", "new", null, "25 hours", null, null, null, null],
  ["h24-closed", "declined", null, "25 hours", null, null, null, null],
  ["h24-deleted", "new", null, "25 hours", null, null, null, "now()"],
  ["h24-applied-step", "new", "submitted", "25 hours", null, null, null, null],
  ["h24-already-sent", "new", null, "25 hours", "now()", null, null, null],
  ["h24-too-old", "new", null, "27 hours", null, null, null, null],
  ["h72-eligible", "new", null, "80 hours", "now() - interval '56 hours'", null, null, null],
  ["h72-no-24h-nudge", "new", null, "80 hours", null, null, null, null],
  ["abandoned-eligible", "partial", null, "30 hours", "now()", null, null, null],
  ["abandoned-too-new", "partial", null, "2 hours", null, null, null, null],
  ["abandoned-too-old", "partial", null, "60 hours", null, null, null, null],
  ["old-draft", "new", null, "10 days", null, null, null, null],
];
function seedApps(extraEligible = 0) {
  psql("DELETE FROM public.applications WHERE email LIKE '%@example.test'");
  const rows = [...SEED, ...Array.from({ length: extraEligible }, (_, k) => [`extra-${k}`, "new", null, "25 hours", null, null, null, null])];
  for (const [tag, status, step, age, s24, s72, sab, deleted] of rows) {
    psql(`SET session_replication_role = replica; INSERT INTO public.applications(full_name, email, phone, status, current_step, created_at,
      recovery_email_sent_24h, recovery_email_sent_72h, recovery_sent_at, deleted_at)
      VALUES ('Syn ${tag}', '${tag}@example.test', '0000000', '${status}', ${step ? `'${step}'` : "NULL"}, now() - interval '${age}',
      ${s24 ?? "NULL"}, ${s72 ?? "NULL"}, ${sab ?? "NULL"}, ${deleted ?? "NULL"})`);
  }
}

try {
  const skipped = up();
  console.log(`replayed migrations (${skipped} skipped, as in the eSign harness)`);
  seedApps();

  // 1. Root cause, reproduced.
  ok(/function extensions\.http_post\(url => unknown, headers => jsonb, body => jsonb\) does not exist/.test(runJob("wizard-recovery-hourly")),
    "root cause: the July wizard-recovery command fails exactly as production logs it");
  ok(/extensions\.http_post/.test(runJob("ops-reminders-daily")), "ops-reminders-daily fails the same way");
  ok(runJob("automations-every-5-min") === "ok", "the working jobs' mechanism (net.http_post) succeeds");

  // 2. Preflight, and parity with the released app's filters.
  const pre = ro("preflight-readonly.sql").reminder_scheduler_preflight ?? ro("preflight-readonly.sql");
  ok(Object.values(pre.gates).every((v) => v === true), "preflight: every gate true on the production-identical job state");
  ok(pre.first_run_eligible.h24 === 1 && pre.first_run_eligible.h72 === 1 && pre.first_run_eligible.abandoned === 1,
    `preflight counts only the eligible rows (24h ${pre.first_run_eligible.h24}, 72h ${pre.first_run_eligible.h72}, abandoned ${pre.first_run_eligible.abandoned})`);
  {
    const out = mkdtempSync(join(tmpdir(), "rr-cronfix-js-"));
    await build({ entryPoints: ["src/lib/wizard-recovery.server.ts"], bundle: true, platform: "node", format: "esm",
      outfile: join(out, "w.mjs"), alias: { "@": resolve("src") }, logLevel: "silent",
      plugins: [{ name: "b", setup(b) { b.onResolve({ filter: /client\.server$/ }, () => ({ path: "x", namespace: "f" })); b.onLoad({ filter: /.*/, namespace: "f" }, () => ({ contents: "export const supabaseAdmin = {};", loader: "js" })); } }] });
    const w = await import(pathToFileURL(join(out, "w.mjs")).href);
    const rows = JSON.parse(psql(`SELECT json_agg(json_build_object('email', email, 'status', status, 'current_step', current_step, 'deleted_at', deleted_at,
      'purged_at', purged_at, 'age_h', extract(epoch from now() - created_at)/3600, 's24', recovery_email_sent_24h, 's72', recovery_email_sent_72h, 'sab', recovery_sent_at))
      FROM public.applications WHERE email LIKE '%@example.test'`));
    const js = { h24: 0, h72: 0, abandoned: 0 };
    for (const r of rows) {
      if (!w.isRecoveryCandidate(r)) continue;
      if (r.age_h >= 24 && r.age_h < 26 && !r.s24) js.h24++;
      if (r.age_h >= 72 && r.age_h < 96 && r.s24 && !r.s72) js.h72++;
      if (r.status === "partial" && r.age_h >= 3 && r.age_h < 48 && !r.sab) js.abandoned++;
    }
    rmSync(out, { recursive: true, force: true });
    ok(js.h24 === pre.first_run_eligible.h24 && js.h72 === pre.first_run_eligible.h72 && js.abandoned === pre.first_run_eligible.abandoned,
      "the package's count matches the released app's own isRecoveryCandidate + windows on the same rows");
  }

  // A partial draft 24-26h old with no abandoned email yet is in both windows: two emails in one run.
  // The cap counts emails, not people, so it covers this case.
  psql(`SET session_replication_role = replica; INSERT INTO public.applications(full_name, email, phone, status, created_at)
    VALUES ('Syn both', 'both@example.test', '0000000', 'partial', now() - interval '25 hours')`);
  {
    const p2 = ro("preflight-readonly.sql");
    const c = (p2.reminder_scheduler_preflight ?? p2).first_run_eligible;
    ok(c.h24 === 2 && c.abandoned === 2, "a partial draft in both windows counts as two emails toward the cap");
  }
  psql("DELETE FROM public.applications WHERE email = 'both@example.test'");

  // 3. Refusals leave everything unchanged.
  const fix = testCopy("fix_wizard_recovery_cron.sql");
  const before = { w: jobMd5("wizard-recovery-hourly"), others: otherJobs() };
  ok(/RRGUARD_BYTES_MISMATCH/.test(send(fix.replace("first_run_cap CONSTANT integer := 10", "first_run_cap CONSTANT integer := 99"))), "a tampered request is refused by the guard");
  ok(/WRONG_TARGET|UNSEALED/.test(send(execFileSync("python3", ["-I", "scripts/sql-guard/gen-guard3.py", join(PKG, "fix_wizard_recovery_cron.sql")], { encoding: "utf8" }) + readFileSync(join(PKG, "fix_wizard_recovery_cron.sql"), "utf8"))),
    "the unmodified production package refuses a database that is not production");
  seedApps(8); // 1 + 1 + 1 + 8 = 11 > 10
  ok(/FIRST_RUN_VOLUME_EXCEEDS_CAP/.test(send(fix)), "first-run volume above the cap (11 > 10) is refused");
  seedApps();
  psql("UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobid = 2");
  ok(/CRON_JOB_DRIFT/.test(send(fix)), "a job that differs from the July definition is refused");
  psql("UPDATE cron.job SET schedule = '15 * * * *' WHERE jobid = 2");
  psql("UPDATE cron.job SET command = command || ' ' WHERE jobid = 3");
  ok(/OPS_JOB_DRIFT/.test(send(fix)), "a changed ops-reminders job is refused (scope guard)");
  psql(`UPDATE cron.job SET command = $c$${JOBS[1][3]}$c$ WHERE jobid = 3`);
  psql("UPDATE private.cron_tokens SET token = '' WHERE name = 'wizard-recovery'");
  ok(/CRON_TOKEN_MISSING/.test(send(fix)), "a missing route token is refused");
  psql("UPDATE private.cron_tokens SET token = 'tok-wizard-recovery' WHERE name = 'wizard-recovery'");
  ok(jobMd5("wizard-recovery-hourly") === before.w && otherJobs() === before.others && psql("SELECT count(*) FROM public.audit_log WHERE entity_id = 'wizard_recovery_cron_fix'") === "0",
    "after every refusal: job unchanged, other jobs unchanged, no evidence row");

  // 4. Install.
  ok(send(fix) === "ok", "the guarded request installs");
  ok(jobMd5("wizard-recovery-hourly") === "478d975efc9c11c5ad5e6c1fe7769ece", "the job now holds exactly the fixed command (md5 478d975e...)");
  ok(otherJobs() === before.others, "every other job (ops-reminders included) is byte-identical");
  ok(psql("SELECT schedule||'|'||active||'|'||username FROM cron.job WHERE jobid = 2") === "15 * * * *|true|postgres", "schedule, active flag and owner unchanged");
  ok(psql("SELECT count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'wizard_recovery_cron_fix'") === "1", "one evidence row");
  psql("DELETE FROM net.calls");
  ok(runJob("wizard-recovery-hourly") === "ok", "the fixed job runs");
  ok(psql("SELECT url||'|'||(headers->>'Authorization') FROM net.calls") === "https://drivereal.com/api/public/cron/wizard-recovery|Bearer tok-wizard-recovery",
    "it posts to the same URL with the route's own token (unchanged lookup)");
  const ver = ro("verify-after-readonly.sql").reminder_scheduler_verify ?? ro("verify-after-readonly.sql");
  ok(ver.job_fixed === true && ver.ops_reminders_untouched === true && ver.evidence_rows === 1, "verify-after: fixed, ops-reminders untouched, one evidence row");
  // A simulated first run, to show verify-after keeps the five outcomes apart:
  // executed, HTTP answered, claimed, provider accepted, delivered.
  psql(`INSERT INTO cron.job_run_details(jobid, start_time, status) VALUES (2, now() + interval '1 second', 'succeeded');
    INSERT INTO net._http_response(id, status_code, content, created) VALUES (1, 200,
      '{"ok":true,"considered_24h":1,"considered_72h":0,"considered_abandoned":1,"sent_24h":1,"sent_72h":0,"sent_abandoned":1,"skipped_claimed":0,"failed":0,"capped":0,"max_claims_per_run":10}', now() + interval '2 seconds');
    SET session_replication_role = replica;
    UPDATE public.applications SET recovery_email_sent_24h = now() + interval '3 seconds' WHERE email = 'h24-eligible@example.test';
    INSERT INTO public.email_deliveries(workflow, recipient, state, accepted_at, delivered_at, created_at, updated_at) VALUES
      ('application_recovery', 'h24-eligible@example.test', 'delivered', now(), now() + interval '9 seconds', now() + interval '4 seconds', now()),
      ('application_recovery', 'abandoned-eligible@example.test', 'accepted', now(), NULL, now() + interval '5 seconds', now()),
      ('application_resume', 'other@example.test', 'accepted', now(), NULL, now() + interval '6 seconds', now());`);
  {
    const v = ro("verify-after-readonly.sql");
    const r = v.reminder_scheduler_verify ?? v;
    ok(r["1_cron_executed"]?.[0]?.status === "succeeded", "verify-after 1: the cron execution is reported on its own");
    ok(r["2_http"]?.[0]?.status === 200 && r["2_http"][0].report?.sent_24h === 1 && r["2_http"][0].report?.max_claims_per_run === 10,
      "verify-after 2: the HTTP status and the route's own report (incl. the per-run cap)");
    ok(r["3_claimed"].s24 === 1 && r["3_claimed"].stamped_on_closed_or_deleted === 0, "verify-after 3: claims (stamps) counted separately");
    ok(r["4_5_email_outcomes"].attempts === 2 && r["4_5_email_outcomes"].provider_accepted === 2 && r["4_5_email_outcomes"].delivered === 1,
      "verify-after 4/5: provider acceptance and webhook-confirmed delivery are separate; other workflows are excluded");
  }
  ok(/CRON_FIX_EVIDENCE_REPLAY/.test(send(fix)), "a replay is refused");

  // 5. Rollback.
  const rb = testCopy("rollback.sql");
  ok(send(rb) === "ok", "the guarded rollback request runs");
  ok(jobMd5("wizard-recovery-hourly") === "1c830e7409ddcb0275cea04ffcca74c9" && otherJobs() === before.others, "rollback restores the July command byte for byte; other jobs untouched");
  ok(/extensions\.http_post/.test(runJob("wizard-recovery-hourly")), "after rollback the job fails again, so nothing can be sent");
  ok(/CRON_FIX_NOT_INSTALLED/.test(send(rb)), "a second rollback is refused");
  ok(/CRON_FIX_EVIDENCE_REPLAY/.test(send(fix)), "re-install after rollback needs a new package version (evidence replay refused)");
} finally {
  down();
}
console.log(`\n${passed} reminder-scheduler-fix checks passed`);
