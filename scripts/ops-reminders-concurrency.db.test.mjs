/**
 * Ops-reminders claim and cap under true concurrency: the runner (src/lib/ops-reminders.server.ts),
 * several invocations at once, against a disposable PostgreSQL 17 served by PostgREST 14.5
 * (production's version), through @supabase/postgrest-js. Every claim insert, read-back, count,
 * release and mark is a real HTTP request and a real committed transaction.
 *
 * Opt-in (npm run test:ops-reminders-concurrency). Needs the PostgREST 14.5 binary at
 * /tmp/pgrst14/postgrest. Ports 55572 (Postgres) and 55573 (PostgREST). Synthetic
 * example.test drivers only; the senders are fakes, so no email is sent. Torn down at the end.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PostgrestClient } from "@supabase/postgrest-js";

const PG = "/opt/pg17/bin";
const PGRST = "/tmp/pgrst14/postgrest";
const PORT = 55572;
const API = 55573;
const D = "/tmp/rr-opsconc-pg";
const U = `postgresql://postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`;
const SECRET = "ops-reminders-concurrency-secret-not-a-real-key-000";
const CAP = 10;
const DRIVER_KINDS = "('past_due','license_expiring','agreement_reminder')";
assert.ok(existsSync(PGRST), "PostgREST 14.5 binary missing at /tmp/pgrst14/postgrest");

const asNobody = (bin, args) =>
  execFileSync("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "env", `HOME=${D}`, `${PG}/${bin}`, ...args], { stdio: "pipe" });
const psql = (sql) => execFileSync("psql", [U, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
let pgrst;
let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; console.log("PASS", name); };

function up() {
  rmSync(D, { recursive: true, force: true });
  execFileSync("mkdir", ["-p", D]); execFileSync("chown", ["65534:65534", D]);
  asNobody("initdb", ["-D", `${D}/data`, "-U", "postgres", "-A", "trust", "--no-sync"]);
  asNobody("pg_ctl", ["-D", `${D}/data`, "-o", `-p ${PORT} -k ${D} -c listen_addresses=127.0.0.1 -c max_connections=100`, "-l", `${D}/log`, "-w", "start"]);
  execFileSync("psql", [U, "-qX", "-f", "scripts/esign-harness/stubs.sql"], { stdio: "ignore" });
  psql("alter database postgres set search_path=public,extensions");
  const files = [...readdirSync("supabase/migrations").map((f) => `supabase/migrations/${f}`), ...readdirSync("drizzle/migrations").map((f) => `drizzle/migrations/${f}`)]
    .filter((f) => f.endsWith(".sql")).sort((a, b) => (a.startsWith("supabase") === b.startsWith("supabase") ? a.localeCompare(b) : a.startsWith("supabase") ? -1 : 1));
  for (const f of files) {
    const sql = readFileSync(f, "utf8").replace(/^\s*create extension[^;]*(pg_net|pg_cron|pg_graphql|supabase_vault|pgsodium)[^;]*;/gim, "");
    try { execFileSync("psql", [U, "-qX", "-v", "ON_ERROR_STOP=1", "-1"], { input: sql, stdio: ["pipe", "ignore", "ignore"] }); } catch {}
  }
  for (const t of ["applications", "payments", "agreements", "vehicles", "documents", "notifications", "outbound_messages"]) {
    assert.equal(psql(`SELECT to_regclass('public.${t}') IS NOT NULL`), "t", `table ${t} missing after replay`);
  }
  // Supabase grants service_role every table by default; the replay does not.
  psql("grant usage on schema public to anon, authenticated, service_role; alter role authenticator with login; grant all on all tables in schema public to service_role");
  writeFileSync(`${D}/pgrst.conf`, `db-uri = "postgresql://authenticator@127.0.0.1:${PORT}/postgres?sslmode=disable"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${SECRET}"\nserver-host = "127.0.0.1"\nserver-port = ${API}\ndb-pool = 20\n`);
  pgrst = spawn(PGRST, [`${D}/pgrst.conf`], { stdio: "ignore" });
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

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const head = b64({ alg: "HS256", typ: "JWT" });
const payload = b64({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${payload}.${createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url")}`;
/** One client per invocation, as separate server processes would have. */
const client = () => new PostgrestClient(`http://127.0.0.1:${API}`, { headers: { Authorization: `Bearer ${TOKEN}`, apikey: TOKEN } });

/** nPast past-due drivers, nLic licence-expiring drivers, nAg unsigned-agreement drivers; one vehicle due for service. */
function seed(nPast, nLic = 0, nAg = 0) {
  psql(`SET session_replication_role = replica;
    DELETE FROM public.outbound_messages; DELETE FROM public.notifications WHERE kind IN ${DRIVER_KINDS};
    DELETE FROM public.agreements WHERE signer_email LIKE '%@example.test';
    DELETE FROM public.payments WHERE notes = 'ops-conc';
    DELETE FROM public.applications WHERE email LIKE '%@example.test';
    DELETE FROM public.vehicles WHERE make = 'OpsConc'; DELETE FROM public.documents WHERE notes = 'ops-conc'`);
  const apps = [];
  for (let i = 0; i < nPast; i++) apps.push(`('Syn pd ${i}', 'pd-${i}@example.test', '0000000', 'approved', NULL)`);
  for (let i = 0; i < nLic; i++) apps.push(`('Syn lic ${i}', 'lic-${i}@example.test', '0000000', 'active', (now() + interval '5 days')::date)`);
  for (let i = 0; i < nAg; i++) apps.push(`('Syn ag ${i}', 'ag-${i}@example.test', '0000000', 'new', NULL)`);
  if (apps.length) psql(`SET session_replication_role = replica; INSERT INTO public.applications(full_name, email, phone, status, license_expiration) VALUES ${apps.join(",")}`);
  if (nPast) psql(`SET session_replication_role = replica; INSERT INTO public.payments(driver_id, amount, due_date, status, notes)
    SELECT id, 120, (now() - interval '5 days')::date, 'pending', 'ops-conc' FROM public.applications WHERE email LIKE 'pd-%@example.test'`);
  if (nAg) psql(`SET session_replication_role = replica; INSERT INTO public.agreements(application_id, title, body, status, sent_at, token_expires_at, signer_email)
    SELECT id, 'Syn', 'Synthetic body', 'sent', now() - interval '5 days', now() + interval '5 days', email FROM public.applications WHERE email LIKE 'ag-%@example.test'`);
  psql(`SET session_replication_role = replica; INSERT INTO public.vehicles(year, make, model, current_odometer, last_oil_change_miles, oil_interval_miles, status)
    VALUES (2020, 'OpsConc', 'Camry', 50000, 40000, 5000, 'available')`);
}
const driverRows = () => Number(psql(`SELECT count(*) FROM public.outbound_messages WHERE kind IN ${DRIVER_KINDS}`));
const queuedRows = () => Number(psql(`SELECT count(*) FROM public.outbound_messages WHERE status = 'queued'`));
const digestRows = () => Number(psql(`SELECT count(*) FROM public.outbound_messages WHERE kind = 'ops_service_digest'`));

let out;
try {
  up();
  await waitApi();
  out = mkdtempSync(join(tmpdir(), "rr-opsconc-"));
  await build({ entryPoints: ["src/lib/ops-reminders.server.ts"], bundle: true, platform: "node", format: "esm",
    outfile: join(out, "o.mjs"), alias: { "@": resolve("src") }, logLevel: "silent",
    plugins: [{ name: "b", setup(b) { b.onResolve({ filter: /client\.server$/ }, () => ({ path: "x", namespace: "f" })); b.onLoad({ filter: /.*/, namespace: "f" }, () => ({ contents: "export const supabaseAdmin = {};", loader: "js" })); } }] });
  const o = await import(pathToFileURL(join(out, "o.mjs")).href);
  assert.equal(o.MAX_DRIVER_EMAILS_PER_RUN, CAP);

  const run = async (jitter) => {
    const sent = [];
    const fake = async (kind, a) => { await new Promise((r) => setTimeout(r, Math.random() * jitter)); sent.push(`${kind}:${a.to}`); return { ok: true, id: `re_${kind}` }; };
    const report = await o.runOpsReminders(client(), {
      sendPastDueReminderEmail: (a) => fake("past_due", a),
      sendLicenseExpiringEmail: (a) => fake("license", a),
      sendEmail: (a) => fake("agreement", a),
      sendServiceDigestEmail: (a) => fake("digest", a),
      log: () => {},
    });
    return { sent, report };
  };
  const drivers = (list) => list.filter((s) => !s.startsWith("digest:"));

  if (process.env.OPS_ROUTE === "before") {
    // The released route (a3df8545, frozen in scripts/fixtures), same database, same fakes:
    // shows the protections it lacks. Expected to fail.
    const { AsyncLocalStorage } = await import("node:async_hooks");
    globalThis.__opsCtx = new AsyncLocalStorage();
    const stubs = {
      "@tanstack/react-router": "export const createFileRoute = () => (options) => ({ options });",
      "@/integrations/supabase/client.server": "export const supabaseAdmin = new Proxy({}, { get: (_, k) => globalThis.__opsCtx.getStore().admin[k] });",
      "@/lib/email.server": `const s = () => globalThis.__opsCtx.getStore().senders;
        export const sendEmail = (a) => s().sendEmail(a); export const sendPastDueReminderEmail = (a) => s().sendPastDueReminderEmail(a);
        export const sendLicenseExpiringEmail = (a) => s().sendLicenseExpiringEmail(a); export const sendServiceDigestEmail = (a) => s().sendServiceDigestEmail(a);`,
    };
    await build({ entryPoints: ["scripts/fixtures/ops-reminders.route.before.ts.txt"], bundle: true, platform: "node", format: "esm",
      outfile: join(out, "before.mjs"), alias: { "@": resolve("src") }, loader: { ".txt": "ts" }, logLevel: "silent",
      plugins: [{ name: "b", setup(b) { b.onResolve({ filter: /.*/ }, (a) => (stubs[a.path] ? { path: a.path, namespace: "f" } : undefined)); b.onLoad({ filter: /.*/, namespace: "f" }, (a) => ({ contents: stubs[a.path], loader: "js" })); } }] });
    const { Route } = await import(pathToFileURL(join(out, "before.mjs")).href);
    const runBefore = (jitter) => {
      const sent = [];
      const fake = async (kind, a) => { await new Promise((r) => setTimeout(r, Math.random() * jitter)); sent.push(`${kind}:${a.to}`); };
      const c = client();
      const admin = { from: (t) => c.from(t), rpc: async () => ({ data: "tok-ops", error: null }) };
      const senders = { sendPastDueReminderEmail: (a) => fake("past_due", a), sendLicenseExpiringEmail: (a) => fake("license", a),
        sendEmail: (a) => fake("agreement", a), sendServiceDigestEmail: (a) => fake("digest", a) };
      return globalThis.__opsCtx.run({ admin, senders }, async () => {
        await Route.options.server.handlers.GET({ request: new Request("https://x/", { headers: { authorization: "Bearer tok-ops" } }) });
        return sent;
      });
    };
    seed(40, 5, 5);
    const runs = await Promise.all(Array.from({ length: 5 }, () => runBefore(10)));
    const all = runs.flat();
    const d = drivers(all);
    console.log(`released route, 5 overlapping runs: ${d.length} driver emails to ${new Set(d).size} people, ${all.length - d.length} digests`);
    ok(d.length <= CAP, `released route: at most ${CAP} driver emails (sent ${d.length})`);
    ok(new Set(d).size === d.length, "released route: nobody emailed twice");
  }

  // 1. One invocation against the real API: at most 10, digest once.
  seed(25, 5, 5);
  const single = await run(5);
  ok(drivers(single.sent).length === CAP && driverRows() === CAP && queuedRows() === 0,
    `one invocation sends ${drivers(single.sent).length} of 35 eligible; ${driverRows()} claim rows, none left queued`);
  ok(single.report.past_due.capped + single.report.license_expiring.capped + single.report.agreement_reminder.capped === 25, "the other 25 are reported as capped, unclaimed");
  const again = await run(5);
  ok(drivers(again.sent).length === 0 && driverRows() === CAP && again.report.budget_reached, "a second invocation within 24h sends 0 and leaves no new claim");
  ok(single.sent.filter((s) => s.startsWith("digest:")).length === 1 && again.sent.filter((s) => s.startsWith("digest:")).length === 0 && digestRows() === 1,
    "the service digest went out once; the second invocation the same day did not repeat it");

  // 2. True concurrency, repeated: K invocations started together, random send delays.
  const trials = [];
  for (const [k, jitter] of [[2, 0], [3, 5], [5, 10], [8, 20], [12, 40], [5, 0], [8, 3], [12, 0], [3, 50], [8, 15]]) {
    seed(40, 5, 5);
    const runs = await Promise.all(Array.from({ length: k }, () => run(jitter)));
    const all = drivers(runs.flatMap((r) => r.sent));
    const people = new Set(all.map((s) => s.split(":")[1]));
    const rows = driverRows();
    const digests = runs.flatMap((r) => r.sent).filter((s) => s.startsWith("digest:")).length;
    trials.push({ k, jitter, sent: all.length, rows, digests });
    assert.ok(all.length <= CAP, `k=${k} jitter=${jitter}: ${all.length} sends`);
    assert.equal(people.size, all.length, `k=${k}: someone was emailed twice`);
    assert.equal(rows, all.length, `k=${k}: ${rows} claim rows for ${all.length} sends (a backed-off or over-budget claim was left behind)`);
    assert.equal(queuedRows(), 0, `k=${k}: claim rows left queued`);
    assert.ok(digests <= 1 && digestRows() === digests, `k=${k}: ${digests} digests, ${digestRows()} digest rows`);
  }
  console.log("trials", JSON.stringify(trials));
  ok(trials.every((t) => t.sent <= CAP), `10 concurrent trials (2-12 overlapping invocations): driver sends per trial ${trials.map((t) => t.sent).join(",")}, never above ${CAP}`);
  ok(trials.every((t) => t.rows === t.sent), "in every trial, claim rows equal sends (backed-off and over-budget claims were deleted unsent)");
  ok(trials.every((t) => t.digests <= 1), `the digest went out at most once per trial (${trials.map((t) => t.digests).join(",")})`);
  ok(trials.filter((t) => t.sent >= 1).length >= 8, `overlapping runs still make progress (${trials.filter((t) => t.sent >= 1).length}/10 trials sent at least one)`);

  // 3. One driver, many simultaneous claimers: at most one email.
  const single1 = [];
  for (let i = 0; i < 10; i++) {
    seed(1);
    const runs = await Promise.all(Array.from({ length: 8 }, () => run(0)));
    const all = drivers(runs.flatMap((r) => r.sent));
    single1.push(all.length);
    assert.ok(all.length <= 1, `one driver emailed ${all.length} times by 8 simultaneous runs`);
    assert.equal(driverRows(), all.length);
  }
  ok(single1.every((n) => n <= 1), `one driver, 8 simultaneous runs, 10 rounds: emails per round ${single1.join(",")} (never 2)`);
  // All eight can back off at once (each sees another's claim); the random-pause retry
  // (CLAIM_ATTEMPTS) lets one of them win, so a collision rarely costs the reminder.
  ok(single1.filter((n) => n === 1).length >= 7, `and the driver was still reminded in ${single1.filter((n) => n === 1).length}/10 rounds`);

  // 4. Claims older than 24h no longer count: a fresh budget, and the 6-day spacing still holds.
  seed(40);
  const first = await Promise.all(Array.from({ length: 4 }, () => run(5)));
  const firstSent = drivers(first.flatMap((r) => r.sent));
  psql(`UPDATE public.outbound_messages SET created_at = created_at - interval '25 hours'`);
  const second = await Promise.all(Array.from({ length: 4 }, () => run(5)));
  const secondSent = drivers(second.flatMap((r) => r.sent));
  ok(firstSent.length <= CAP && secondSent.length <= CAP && secondSent.length >= 1, `day 1 sent ${firstSent.length}, day 2 sent ${secondSent.length} (each at most ${CAP})`);
  ok(new Set([...firstSent, ...secondSent]).size === firstSent.length + secondSent.length, "nobody emailed twice across the two days (6-day spacing)");
} finally {
  if (out) rmSync(out, { recursive: true, force: true });
  down();
}
console.log(`\n${passed} ops-reminders concurrency checks passed`);
