/**
 * Ops reminders scheduler fix v1 (proposed/ops-reminders-scheduler-fix), on a disposable PostgreSQL 17.
 *
 * Opt-in (npm run test:ops-reminders-scheduler-fix): initdb on 127.0.0.1:55576 as uid 65534,
 * replays this tree's migrations, then stands in for the two hosted extensions the package
 * touches: a cron schema (job, job_run_details, alter_job) and net.http_post, which records
 * the call instead of making it. PostgREST 14.5 on 127.0.0.1:55577 serves the same database so
 * the real runner (src/lib/ops-reminders.server.ts, fake senders) can be compared with the
 * package's own first-run count. No network beyond 127.0.0.1, no hosted database, torn down at the end.
 *
 * The cron.job rows are the production commands byte for byte (md5-checked below), with job 2
 * already holding the installed wizard-recovery fix, so the package's drift and scope gates run
 * against the real text. Test copies change only the package's profile line (database + system
 * identifier), as the wizard package's suite does.
 *
 * Not reproducible locally: hosted privileges (postgres is superuser here) and pg_cron's own
 * alter_job ownership check; the stub enforces job owner = current_user.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PostgrestClient } from "@supabase/postgrest-js";

const PG = "/opt/pg17/bin";
const PGRST = "/tmp/pgrst14/postgrest";
const PORT = 55576;
const API = 55577;
const D = "/tmp/rr-opsfix-pg";
const U = `postgresql://postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`;
const SECRET = "ops-reminders-scheduler-fix-secret-not-a-real-key-00";
const PKG = "proposed/ops-reminders-scheduler-fix";
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: test\n-- date: 2026-10-26T00:00:00.000Z";
const PROD_PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';
const BROKEN = "7a6594649bd441f8ecb8baf8fc529368";
const FIXED = "9d4bc178b65e26da0d7899c96809fc44";
const WIZARD_FIXED = "478d975efc9c11c5ad5e6c1fe7769ece";
const md5 = (s) => createHash("md5").update(s).digest("hex");
assert.ok(existsSync(PGRST), "PostgREST 14.5 binary missing at /tmp/pgrst14/postgrest");
const asNobody = (bin, args, opts = {}) =>
  execFileSync("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "env", `HOME=${D}`, `${PG}/${bin}`, ...args], { stdio: "pipe", ...opts });
const psql = (sql) => execFileSync("psql", [U, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
const send = (text) => {
  // One simple-query message, one implicit transaction: what the Management API sends.
  try { execFileSync("psql", [U, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", text + TRAILER], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return "ok"; }
  catch (e) { return String(e.stderr || e.message).match(/ERROR:\s+([^\n]+)/)?.[1] ?? String(e.stderr); }
};

let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; console.log("PASS", name); };

/** Production commands (cron.job), reproduced exactly; md5s asserted against production values. */
const cmd = (name, fn) => `\n  SELECT ${fn}(\n    url := 'https://drivereal.com/api/public/cron/${name}',\n    headers := jsonb_build_object(\n      'Content-Type', 'application/json',\n      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = '${name}')\n    ),\n    body := '{}'::jsonb\n  ) AS request_id;\n  `;
const JOBS = [
  [2, "wizard-recovery-hourly", "15 * * * *", cmd("wizard-recovery", "net.http_post")], // installed fix (2026-10-25)
  [3, "ops-reminders-daily", "30 13 * * *", cmd("ops-reminders", "extensions.http_post")],
  [4, "automations-every-5-min", "*/5 * * * *", cmd("automations", "net.http_post")],
  [5, "late-fees-daily", "30 11 * * *", cmd("late-fees", "net.http_post")],
  [6, "esign-archive-retry-hourly", "45 * * * *", cmd("esign-archive-retry", "net.http_post")],
];
assert.equal(md5(JOBS[0][3]), WIZARD_FIXED);
assert.equal(md5(JOBS[1][3]), BROKEN);
assert.equal(md5(JOBS[2][3]), "454777d5c3981594314497dc1017f1b1");
assert.equal(md5(cmd("ops-reminders", "net.http_post")), FIXED);
assert.equal(md5(cmd("wizard-recovery", "extensions.http_post")), "1c830e7409ddcb0275cea04ffcca74c9");

const STUBS = `
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
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls(url, headers, body) VALUES (url, headers, body) RETURNING id $$;
CREATE TABLE IF NOT EXISTS net._http_response (id bigint, status_code int, content text, created timestamptz DEFAULT now(), error_msg text);
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.cron_tokens (name text PRIMARY KEY, token text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
`;

let pgrst;
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
  // Production cron state, exactly (job 2 already fixed; job 3 still the August text).
  psql(`DELETE FROM cron.job; INSERT INTO private.cron_tokens(name, token) VALUES ('wizard-recovery','tok-wizard-recovery'),('ops-reminders','tok-ops'),('automations','tok-auto') ON CONFLICT (name) DO UPDATE SET token = EXCLUDED.token;`);
  for (const [id, name, sched, command] of JOBS) {
    psql(`INSERT INTO cron.job(jobid, jobname, schedule, command, username, database, active) VALUES (${id}, '${name}', '${sched}', $c$${command}$c$, 'postgres', 'postgres', true)`);
  }
  psql("grant usage on schema public to anon, authenticated, service_role; alter role authenticator with login; grant all on all tables in schema public to service_role");
  writeFileSync(`${D}/pgrst.conf`, `db-uri = "postgresql://authenticator@127.0.0.1:${PORT}/postgres?sslmode=disable"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${SECRET}"\nserver-host = "127.0.0.1"\nserver-port = ${API}\ndb-pool = 10\n`);
  pgrst = spawn(PGRST, [`${D}/pgrst.conf`], { stdio: "ignore" });
  return skipped;
}
async function waitApi() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${API}/`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("PostgREST did not start");
}
function down() {
  try { pgrst?.kill("SIGTERM"); } catch {}
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
  const dir = mkdtempSync(join(tmpdir(), "rr-opsfix-")); const p = join(dir, file);
  writeFileSync(p, lines.join("\n"));
  const out = execFileSync("python3", ["-I", "scripts/sql-guard/gen-guard3.py", p], { encoding: "utf8" }) + lines.join("\n");
  rmSync(dir, { recursive: true, force: true });
  return out;
}
const ro = (file) => {
  const row = JSON.parse(psql(`BEGIN READ ONLY; ${readFileSync(join(PKG, file), "utf8").replace(/;\s*$/, "")}; COMMIT;`).split("\n").find((l) => l.startsWith("{")));
  assert.equal(row.transaction_read_only, "on");
  return row;
};
const jobMd5 = (name) => psql(`SELECT md5(command) FROM cron.job WHERE jobname = '${name}'`);
const otherJobs = () => psql("SELECT string_agg(jobid||':'||md5(command)||':'||schedule||':'||active, ',' ORDER BY jobid) FROM cron.job WHERE jobid <> 3");
const runJob = (name) => { try { psql(`DO $r$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = '${name}'); END $r$`); return "ok"; } catch (e) { return String(e.stderr || e.message); } };
const evidence = () => psql("SELECT count(*) FROM public.audit_log WHERE entity_id = 'ops_reminders_cron_fix'");

/** Synthetic drivers, one per eligibility edge. Expected: 3 past due, 2 licences, 2 agreements. */
function seed(extraPastDue = 0) {
  psql(`SET session_replication_role = replica;
    DELETE FROM public.outbound_messages; DELETE FROM public.notifications WHERE kind IN ('past_due','license_expiring','agreement_reminder');
    DELETE FROM public.agreements WHERE body = 'ops-fix'; DELETE FROM public.payments WHERE notes = 'ops-fix';
    DELETE FROM public.applications WHERE email LIKE '%@example.test' OR full_name LIKE 'Syn %';
    DELETE FROM public.vehicles WHERE make = 'OpsFix'; DELETE FROM public.documents WHERE notes = 'ops-fix';`);
  const apps = [
    ["pd", "approved", "", null], ["pd-backlog", "approved", "", null], ["pd-two", "approved", "", null],
    ["pd-zero", "approved", "", null], ["pd-today", "approved", "", null], ["pd-paid", "approved", "", null],
    ["pd-recent", "approved", "", null], ["pd-no-email", "approved", "blank", null], ["pd-negative", "approved", "", null],
    ["lic-soon", "approved", "", "10 days"], ["lic-expired", "active", "", "-300 days"], ["lic-pending", "declined", "", "10 days"],
    ["lic-far", "approved", "", "45 days"], ["lic-recent", "approved", "", "5 days"],
    ["ag-1", "new", "", null], ["ag-twice", "new", "", null], ["ag-young", "new", "", null], ["ag-expired", "new", "", null],
    ["ag-signed", "new", "", null], ["ag-recent", "new", "", null],
    ...Array.from({ length: extraPastDue }, (_, k) => [`pdx-${k}`, "approved", "", null]),
  ];
  psql(`SET session_replication_role = replica; INSERT INTO public.applications(full_name, email, phone, status, license_expiration) VALUES ${apps
    .map(([tag, status, mail, lic]) => `('Syn ${tag}', '${mail === "blank" ? "" : `${tag}@example.test`}', '0000000', '${status}', ${lic ? `(now() + interval '${lic}')::date` : "NULL"})`).join(",")}`);
  const id = (tag) => `(SELECT id FROM public.applications WHERE full_name = 'Syn ${tag}')`;
  const pay = (tag, amount, balance, due, status) =>
    `(${id(tag)}, ${amount}, ${balance ?? 0}, (now() AT TIME ZONE 'UTC')::date - ${due}, '${status}', 'ops-fix')`;
  psql(`SET session_replication_role = replica; INSERT INTO public.payments(driver_id, amount, balance_due, due_date, status, notes) VALUES
    ${[pay("pd", 100, null, 5, "pending"), pay("pd-backlog", 100, null, 400, "overdue"), pay("pd-two", 100, null, 5, "late"), pay("pd-two", 999, 40, 10, "unpaid"),
      pay("pd-zero", 0, 0, 5, "failed"), pay("pd-today", 100, null, 0, "pending"), pay("pd-paid", 100, null, 5, "paid"), pay("pd-recent", 100, null, 5, "pending"),
      pay("pd-no-email", 100, null, 5, "pending"), pay("pd-negative", 100, -20, 5, "pending"),
      ...Array.from({ length: extraPastDue }, (_, k) => pay(`pdx-${k}`, 50, null, 3, "past_due"))].join(",")}`);
  const ag = (tag, status, sentAgo, expiresIn) =>
    `(${id(tag)}, 'Syn', 'ops-fix', '${status}', now() - interval '${sentAgo}', now() + interval '${expiresIn}', NULL)`;
  psql(`SET session_replication_role = replica; INSERT INTO public.agreements(application_id, title, body, status, sent_at, token_expires_at, signer_email) VALUES
    ${[ag("ag-1", "sent", "5 days", "5 days"), ag("ag-twice", "sent", "6 days", "5 days"), ag("ag-twice", "viewed", "4 days", "5 days"),
      ag("ag-young", "sent", "2 days", "5 days"), ag("ag-expired", "sent", "9 days", "-1 days"), ag("ag-signed", "signed", "9 days", "5 days"),
      ag("ag-recent", "sent", "5 days", "5 days")].join(",")}`);
  const om = (tag, kind, ago) => `('email', '${tag}@example.test', 'old', 'sent', '${kind}', ${id(tag)}, now() - interval '${ago}')`;
  psql(`SET session_replication_role = replica; INSERT INTO public.outbound_messages(channel, to_address, body, status, kind, application_id, created_at) VALUES
    ${[om("pd-recent", "past_due", "2 days"), om("lic-recent", "license_expiring", "3 days"), om("ag-recent", "agreement_reminder", "1 day")].join(",")}`);
  psql(`SET session_replication_role = replica; INSERT INTO public.vehicles(year, make, model, current_odometer, last_oil_change_miles, oil_interval_miles, status)
    VALUES (2020, 'OpsFix', 'Camry', 50000, 40000, 5000, 'available'), (2019, 'OpsFix', 'Civic', 90000, 10000, 5000, 'retired')`);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtHead = b64({ alg: "HS256", typ: "JWT" });
const jwtBody = b64({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${jwtHead}.${jwtBody}.${createHmac("sha256", SECRET).update(`${jwtHead}.${jwtBody}`).digest("base64url")}`;

// The committed request files are exactly guard v3 + the package bytes, and SHA256SUMS matches every file.
for (const [req, pkg] of [["request-fix-ops-reminders-cron.sql", "fix_ops_reminders_cron.sql"], ["request-rollback-ops-reminders-cron.sql", "rollback.sql"]]) {
  const expected = execFileSync("python3", ["-I", "scripts/sql-guard/gen-guard3.py", join(PKG, pkg)], { encoding: "utf8" }) + readFileSync(join(PKG, pkg), "utf8");
  ok(readFileSync(join(PKG, req), "utf8") === expected, `${req} = gen-guard3(${pkg}) + ${pkg}, byte for byte`);
}
{
  const sums = readFileSync(join(PKG, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => l.split(/\s+/));
  ok(sums.length === 7 && sums.every(([h, f]) => createHash("sha256").update(readFileSync(join(PKG, f))).digest("hex") === h),
    "SHA256SUMS matches all six package files and the guard generator");
  ok(sums.some(([h, f]) => f.endsWith("gen-guard3.py") && h === "2c8c8967cee235af6a2475044b8ad5638b7361b985f8a74c699b9655cba966f7"),
    "the guard generator is the reviewed one (sha256 2c8c8967...)");
}

let out;
try {
  const skipped = up();
  console.log(`replayed migrations (${skipped} skipped, as in the eSign harness)`);
  await waitApi();
  seed();

  // 1. Root cause, reproduced.
  ok(/function extensions\.http_post\(url => unknown, headers => jsonb, body => jsonb\) does not exist/.test(runJob("ops-reminders-daily")),
    "root cause: the August ops-reminders command fails exactly as production logs it");
  ok(runJob("wizard-recovery-hourly") === "ok" && runJob("automations-every-5-min") === "ok", "the installed wizard fix and the working jobs (net.http_post) succeed");

  // 2. Preflight, and parity with the runner itself on the same rows.
  const pre = ro("preflight-readonly.sql");
  ok(Object.values(pre.gates).every((v) => v === true), "preflight: every gate true on the production-identical job state");
  const e = pre.first_run_eligible;
  ok(e.past_due === 3 && e.license_expiring === 2 && e.agreement_reminder === 2 && e.total_driver_emails === 7,
    `preflight counts only the eligible rows (past due ${e.past_due}, licence ${e.license_expiring}, agreements ${e.agreement_reminder})`);
  ok(pre.backlog.past_due_by_oldest_due.over_90_days === 1 && pre.backlog.licence.already_expired === 1,
    "preflight shows the unbounded categories' backlog (past due over 90 days, licences already expired)");
  ok(pre.team_digests.service_due_vehicles === 1, "preflight counts service-due vehicles the way the digest does (retired excluded)");
  {
    out = mkdtempSync(join(tmpdir(), "rr-opsfix-js-"));
    await build({ entryPoints: ["src/lib/ops-reminders.server.ts"], bundle: true, platform: "node", format: "esm",
      outfile: join(out, "o.mjs"), alias: { "@": resolve("src") }, logLevel: "silent",
      plugins: [{ name: "b", setup(b) { b.onResolve({ filter: /client\.server$/ }, () => ({ path: "x", namespace: "f" })); b.onLoad({ filter: /.*/, namespace: "f" }, () => ({ contents: "export const supabaseAdmin = {};", loader: "js" })); } }] });
    const o = await import(pathToFileURL(join(out, "o.mjs")).href);
    const sent = [];
    const fake = (kind) => async (a) => { sent.push(`${kind}:${a.to}`); return { ok: true, id: "re_fixture" }; };
    const report = await o.runOpsReminders(new PostgrestClient(`http://127.0.0.1:${API}`, { headers: { Authorization: `Bearer ${TOKEN}`, apikey: TOKEN } }), {
      sendPastDueReminderEmail: fake("past_due"), sendLicenseExpiringEmail: fake("license"), sendEmail: fake("agreement"), sendServiceDigestEmail: fake("digest"), log: () => {},
    });
    ok(report.past_due.sent === e.past_due && report.license_expiring.sent === e.license_expiring && report.agreement_reminder.sent === e.agreement_reminder,
      `the package's count equals what the runner sends on the same rows (runner: ${report.past_due.sent}/${report.license_expiring.sent}/${report.agreement_reminder.sent})`);
    ok(report.service_digest.items === pre.team_digests.service_due_vehicles && report.service_digest.sent === 1, "service digest items match; one digest");
    const again = ro("preflight-readonly.sql").first_run_eligible;
    ok(again.total_driver_emails === 0, "after that run the preflight counts 0 (the claim rows are the 6-day spacing)");
    seed();
  }

  // 3. Refusals leave everything unchanged.
  const fix = testCopy("fix_ops_reminders_cron.sql");
  const before = { o: jobMd5("ops-reminders-daily"), others: otherJobs() };
  ok(/RRGUARD_BYTES_MISMATCH/.test(send(fix.replace("first_run_cap CONSTANT integer := 10", "first_run_cap CONSTANT integer := 99"))), "a tampered request is refused by the guard");
  ok(/WRONG_TARGET|UNSEALED/.test(send(readFileSync(join(PKG, "request-fix-ops-reminders-cron.sql"), "utf8"))),
    "the committed production request refuses a database that is not production");
  seed(4); // 3 + 2 + 2 + 4 = 11 > 10
  ok(/FIRST_RUN_VOLUME_EXCEEDS_CAP/.test(send(fix)), "first-run volume above the cap (11 > 10) is refused");
  seed(3); // exactly 10: the install below runs at this boundary
  ok(ro("preflight-readonly.sql").first_run_eligible.total_driver_emails === 10, "10 eligible is within the cap (preflight)");
  psql("UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobid = 3");
  ok(/CRON_JOB_DRIFT/.test(send(fix)), "a job that differs from the August definition is refused");
  psql("UPDATE cron.job SET schedule = '30 13 * * *' WHERE jobid = 3");
  psql(`UPDATE cron.job SET command = $c$${cmd("wizard-recovery", "extensions.http_post")}$c$ WHERE jobid = 2`);
  ok(/WIZARD_JOB_DRIFT/.test(send(fix)), "refused unless job 2 holds the installed wizard fix (scope guard)");
  psql(`UPDATE cron.job SET command = $c$${JOBS[0][3]}$c$ WHERE jobid = 2`);
  psql("UPDATE private.cron_tokens SET token = '' WHERE name = 'ops-reminders'");
  ok(/CRON_TOKEN_MISSING/.test(send(fix)), "a missing route token is refused");
  psql("UPDATE private.cron_tokens SET token = 'tok-ops' WHERE name = 'ops-reminders'");
  ok(jobMd5("ops-reminders-daily") === before.o && otherJobs() === before.others && evidence() === "0",
    "after every refusal: job unchanged, other jobs unchanged, no evidence row");

  // 4. Install, with exactly 10 driver emails eligible.
  ok(send(fix) === "ok", "the guarded request installs (first run at the cap: 10 eligible)");
  ok(JSON.parse(psql("SELECT metadata->>'first_run_eligible' FROM public.audit_log WHERE entity_id = 'ops_reminders_cron_fix'")).past_due === 6,
    "the evidence row records the first-run counts");
  ok(jobMd5("ops-reminders-daily") === FIXED, "the job now holds exactly the fixed command (md5 9d4bc178...)");
  ok(otherJobs() === before.others && jobMd5("wizard-recovery-hourly") === WIZARD_FIXED, "every other job (wizard-recovery included) is byte-identical");
  ok(psql("SELECT schedule||'|'||active||'|'||username FROM cron.job WHERE jobid = 3") === "30 13 * * *|true|postgres", "schedule, active flag and owner unchanged");
  ok(evidence() === "1", "one evidence row (entity_id ops_reminders_cron_fix)");
  psql("DELETE FROM net.calls");
  ok(runJob("ops-reminders-daily") === "ok", "the fixed job runs");
  ok(psql("SELECT url||'|'||(headers->>'Authorization') FROM net.calls") === "https://drivereal.com/api/public/cron/ops-reminders|Bearer tok-ops",
    "it posts to the same URL with the route's own token (unchanged lookup)");
  const ver = ro("verify-after-readonly.sql");
  ok(ver.job_fixed === true && ver.wizard_recovery_untouched === true && ver.evidence_rows === 1, "verify-after: fixed, wizard-recovery untouched, one evidence row");
  // A simulated first run, to show verify-after keeps the five outcomes apart.
  psql(`INSERT INTO cron.job_run_details(jobid, start_time, status) VALUES (3, now() + interval '1 second', 'succeeded'), (2, now() + interval '1 second', 'succeeded');
    INSERT INTO net._http_response(id, status_code, content, created) VALUES
      (1, 200, '{"ok":true,"past_due":{"considered":3,"sent":1,"failed":0,"capped":0,"skipped_recent":1,"skipped_claimed":0,"skipped_no_email":0},"budget_reached":false,"max_driver_emails_per_run":10}', now() + interval '2 seconds'),
      (2, 200, '{"ok":true,"considered_24h":0}', now() + interval '2 seconds');
    INSERT INTO public.outbound_messages(channel, to_address, body, status, kind, application_id, created_at, error) VALUES
      ('email', 'pd@example.test', 'x', 'sent', 'past_due', (SELECT id FROM public.applications WHERE full_name = 'Syn pd'), now() + interval '3 seconds', NULL),
      ('email', 'lic-soon@example.test', 'x', 'queued', 'license_expiring', (SELECT id FROM public.applications WHERE full_name = 'Syn lic-soon'), now() + interval '3 seconds', 'uncertain: timeout'),
      ('email', 'team@drivereal.com', 'x', 'sent', 'ops_service_digest', NULL, now() + interval '3 seconds', NULL);
    INSERT INTO public.email_deliveries(workflow, recipient, state, accepted_at, delivered_at, created_at, updated_at) VALUES
      ('payment_past_due', 'pd@example.test', 'delivered', now(), now() + interval '9 seconds', now() + interval '4 seconds', now()),
      ('license_expiring', 'lic-soon@example.test', 'failed', NULL, NULL, now() + interval '4 seconds', now()),
      ('service_digest', 'team@drivereal.com', 'accepted', now(), NULL, now() + interval '5 seconds', now()),
      ('application_recovery', 'other@example.test', 'accepted', now(), NULL, now() + interval '6 seconds', now());`);
  {
    const r = ro("verify-after-readonly.sql");
    ok(r["1_cron_executed"]?.length === 1 && r["1_cron_executed"][0].status === "succeeded", "verify-after 1: this job's cron execution is reported on its own (job 2's is not)");
    ok(r["2_http"]?.length === 1 && r["2_http"][0].status === 200 && r["2_http"][0].report?.past_due?.sent === 1 && r["2_http"][0].report?.max_driver_emails_per_run === 10,
      "verify-after 2: the HTTP status and this route's own report (the wizard's report is excluded)");
    const c = r["3_claimed"];
    ok(c.by_kind.past_due.sent === 1 && c.by_kind.license_expiring.queued === 1 && c.by_kind.license_expiring.uncertain === 1 && c.by_kind.ops_service_digest.sent === 1
      && c.max_driver_claims_in_any_utc_day_le_10 === true && c.drivers_reminded_twice_within_6_days === 0 && c.digests_more_than_once_a_day === 0,
      "verify-after 3: claims per kind and status (uncertain kept claims visible), per-day cap and no double reminders");
    const m = r["4_5_email_outcomes"];
    ok(m.payment_past_due.provider_accepted === 1 && m.payment_past_due.delivered === 1 && m.license_expiring.provider_failed === 1
      && m.service_digest.provider_accepted === 1 && m.service_digest.delivered === 0 && !m.application_recovery,
      "verify-after 4/5: provider acceptance and webhook-confirmed delivery per workflow; other workflows excluded");
  }
  ok(/CRON_FIX_EVIDENCE_REPLAY/.test(send(fix)), "a replay is refused");

  // 5. Rollback.
  const rb = testCopy("rollback.sql");
  ok(send(rb) === "ok", "the guarded rollback request runs");
  ok(jobMd5("ops-reminders-daily") === BROKEN && otherJobs() === before.others, "rollback restores the August command byte for byte; other jobs untouched");
  ok(/extensions\.http_post/.test(runJob("ops-reminders-daily")), "after rollback the job fails again, so nothing can be sent");
  ok(/CRON_FIX_NOT_INSTALLED/.test(send(rb)), "a second rollback is refused");
  ok(/CRON_FIX_EVIDENCE_REPLAY/.test(send(fix)), "re-install after rollback needs a new package version (evidence replay refused)");
} finally {
  if (out) rmSync(out, { recursive: true, force: true });
  down();
}
console.log(`\n${passed} ops-reminders-scheduler-fix checks passed`);
