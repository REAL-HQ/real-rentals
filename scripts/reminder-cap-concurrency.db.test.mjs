/**
 * Reminder cap under true concurrency: the released runner (src/lib/wizard-recovery.server.ts),
 * several invocations at once, against a disposable PostgreSQL 17 served by PostgREST 14.5
 * (production's version), through @supabase/postgrest-js. Every claim, count and release is a
 * real HTTP request and a real committed transaction.
 *
 * Opt-in (npm run test:reminder-cap-concurrency). Needs the PostgREST 14.5 binary at
 * /tmp/pgrst14/postgrest. Ports 55562 (Postgres) and 55563 (PostgREST). Synthetic
 * example.test applicants only; the senders are fakes, so no email is sent. Torn down at the end.
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
const PORT = 55562;
const API = 55563;
const D = "/tmp/rr-capconc-pg";
const U = `postgresql://postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`;
const SECRET = "reminder-cap-concurrency-secret-not-a-real-key-0000";
const CAP = 10;
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
  psql("grant usage on schema public to anon, authenticated, service_role; alter role authenticator with login; grant all on public.applications to service_role");
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

function seed(n24, nAbandoned) {
  psql("SET session_replication_role = replica; DELETE FROM public.applications WHERE email LIKE '%@example.test'");
  const vals = [];
  for (let i = 0; i < n24; i++) vals.push(`('Syn h24 ${i}', 'h24-${i}@example.test', '0000000', 'new', NULL, now() - interval '25 hours')`);
  for (let i = 0; i < nAbandoned; i++) vals.push(`('Syn ab ${i}', 'ab-${i}@example.test', '0000000', 'partial', NULL, now() - interval '5 hours')`);
  psql(`SET session_replication_role = replica; INSERT INTO public.applications(full_name, email, phone, status, current_step, created_at) VALUES ${vals.join(",")}`);
}
const stamped = () => Number(psql(`SELECT count(*) FROM public.applications WHERE email LIKE '%@example.test'
  AND (recovery_email_sent_24h IS NOT NULL OR recovery_email_sent_72h IS NOT NULL OR recovery_sent_at IS NOT NULL)`));

try {
  up();
  await waitApi();
  const out = mkdtempSync(join(tmpdir(), "rr-capconc-"));
  await build({ entryPoints: ["src/lib/wizard-recovery.server.ts"], bundle: true, platform: "node", format: "esm",
    outfile: join(out, "w.mjs"), alias: { "@": resolve("src") }, logLevel: "silent",
    plugins: [{ name: "b", setup(b) { b.onResolve({ filter: /client\.server$/ }, () => ({ path: "x", namespace: "f" })); b.onLoad({ filter: /.*/, namespace: "f" }, () => ({ contents: "export const supabaseAdmin = {};", loader: "js" })); } }] });
  const w = await import(pathToFileURL(join(out, "w.mjs")).href);
  assert.equal(w.MAX_REMINDER_CLAIMS_PER_RUN, CAP);

  const run = async (jitter) => {
    const sent = [];
    const fake = async (kind, a) => { await new Promise((r) => setTimeout(r, Math.random() * jitter)); sent.push(`${kind}:${a.applicationId}`); return { ok: true }; };
    const report = await w.runWizardRecovery(client(), {
      sendWizardRecoveryEmail: (a) => fake(a.variant, a),
      sendAbandonedRecoveryEmail: (a) => fake("abandoned", a),
      log: () => {},
    });
    return { sent, report };
  };

  // 1. One invocation against the real API: at most 10.
  seed(25, 5);
  const single = await run(5);
  ok(single.sent.length === CAP && stamped() === CAP, `one invocation sends ${single.sent.length} of 30 eligible; ${stamped()} stamped`);
  const again = await run(5);
  ok(again.sent.length === 0 && stamped() === CAP, "a second invocation within the hour sends 0 and leaves no new stamp");

  // 2. True concurrency, repeated: K invocations started together, random send delays.
  const trials = [];
  for (const [k, jitter] of [[2, 0], [3, 5], [5, 10], [8, 20], [12, 40], [5, 0], [8, 3], [12, 0], [3, 50], [8, 15]]) {
    seed(40, 10);
    const runs = await Promise.all(Array.from({ length: k }, () => run(jitter)));
    const all = runs.flatMap((r) => r.sent);
    const people = new Set(all.map((s) => s.split(":")[1]));
    const s = stamped();
    trials.push({ k, jitter, sent: all.length, stamped: s });
    assert.ok(all.length <= CAP, `k=${k} jitter=${jitter}: ${all.length} sends`);
    assert.equal(people.size, all.length, `k=${k}: someone was emailed twice`);
    assert.equal(s, all.length, `k=${k}: ${s} stamps for ${all.length} sends (a released claim left a stamp)`);
    assert.ok(all.length >= 1, `k=${k}: nothing sent`);
  }
  console.log("trials", JSON.stringify(trials));
  ok(trials.every((t) => t.sent <= CAP), `10 concurrent trials (2-12 overlapping invocations): sends per trial ${trials.map((t) => t.sent).join(",")}, never above ${CAP}`);
  ok(trials.every((t) => t.stamped === t.sent), "in every trial, stamps equal sends (over-budget claims were released unsent)");

  // 3. Stamps older than the hour no longer count: the next hour gets a fresh budget of 10, nobody twice.
  seed(40, 0);
  const first = await Promise.all(Array.from({ length: 4 }, () => run(5)));
  const firstSent = first.flatMap((r) => r.sent);
  psql("UPDATE public.applications SET recovery_email_sent_24h = recovery_email_sent_24h - interval '61 minutes' WHERE recovery_email_sent_24h IS NOT NULL AND email LIKE '%@example.test'");
  const second = await Promise.all(Array.from({ length: 4 }, () => run(5)));
  const secondSent = second.flatMap((r) => r.sent);
  ok(firstSent.length <= CAP && secondSent.length <= CAP && secondSent.length >= 1, `hour 1 sent ${firstSent.length}, hour 2 sent ${secondSent.length} (each at most ${CAP})`);
  ok(new Set([...firstSent, ...secondSent]).size === firstSent.length + secondSent.length, "nobody emailed twice across the two hours");
  rmSync(out, { recursive: true, force: true });
} finally {
  down();
}
console.log(`\n${passed} reminder-cap concurrency checks passed`);
