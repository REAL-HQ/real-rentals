/**
 * Resume-token properties on a REAL PostgreSQL (PR 4).
 *
 * A private throwaway cluster: 127.0.0.1:55492, data dir /tmp/wt-pr4-pg,
 * run as uid 65534 via setpriv (the scripts/esign-harness/up.sh pattern),
 * stopped and deleted at the end. No network, no hosted backend.
 *
 * PostgREST is NOT running here (installing it needs the network). Instead
 * the real resume-tokens.server.ts runs against a small adapter that turns
 * each supabase-js query-builder chain into the single SQL statement
 * PostgREST would run for it (filters -> WHERE, .select() after a write ->
 * RETURNING), executed in autocommit, one statement per request, on its own
 * pooled connection — the same isolation PostgREST gives each request. The
 * table is created from the real migration DDL.
 *
 * Needs root (for setpriv) and /opt/pg17/bin. Run: node scripts/resume-token-postgres.test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, chownSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import postgres from "postgres";

const PORT = 55492;
const DIR = "/tmp/wt-pr4-pg";
const BIN = "/opt/pg17/bin";
if (process.getuid?.() !== 0 || !existsSync(`${BIN}/pg_ctl`)) {
  console.log("SKIP resume-token-postgres: needs root and /opt/pg17/bin");
  process.exit(0);
}
const asPg = (cmd, args) =>
  execFileSync(
    "setpriv",
    ["--reuid=65534", "--regid=65534", "--clear-groups", "env", `HOME=${DIR}`, `${BIN}/${cmd}`, ...args],
    { stdio: "ignore" },
  );

const out = mkdtempSync(join(tmpdir(), "rr-token-pg-"));
let sql;
let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log("PASS", name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stop() {
  try {
    asPg("pg_ctl", ["-D", `${DIR}/data`, "-m", "immediate", "stop"]);
  } catch {}
  rmSync(DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------- adapter
const iso = (v) => (v instanceof Date ? v.toISOString() : v);
const row2json = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, iso(v)]));
const ident = (c) => {
  assert.match(c, /^[a-z_][a-z0-9_]*$/);
  return `"${c}"`;
};

/** supabase-js-shaped client. `run(text, params)` executes one statement. */
function adapter(run, log = []) {
  return {
    from(table) {
      const st = { op: "select", cols: "*", values: null, where: [], orders: [], returning: null, one: null };
      const params = [];
      const p = (v) => {
        params.push(v);
        return `$${params.length}`;
      };
      const cols = (c) => (c === "*" ? "*" : c.split(",").map((x) => ident(x.trim())).join(", "));
      const q = {
        select(c = "*") {
          if (st.op === "select") st.cols = c;
          else st.returning = c;
          return q;
        },
        insert(v) { st.op = "insert"; st.values = v; return q; },
        update(v) { st.op = "update"; st.values = v; return q; },
        eq(k, v) { st.where.push(() => `${ident(k)} = ${p(v)}`); return q; },
        gt(k, v) { st.where.push(() => `${ident(k)} > ${p(v)}`); return q; },
        is(k, v) { assert.equal(v, null); st.where.push(() => `${ident(k)} IS NULL`); return q; },
        in(k, vs) { st.where.push(() => `${ident(k)} IN (${vs.map((v) => p(v)).join(", ")})`); return q; },
        order(k, o) { st.orders.push(`${ident(k)} ${o?.ascending === false ? "DESC" : "ASC"}`); return q; },
        single() { st.one = "single"; return q; },
        maybeSingle() { st.one = "maybe"; return q; },
        then(resolveFn, rejectFn) {
          return (async () => {
            const t = `public.${ident(table)}`;
            let text;
            if (st.op === "insert") {
              const keys = Object.keys(st.values);
              const vals = keys.map((k) => p(st.values[k]));
              text = `INSERT INTO ${t} (${keys.map(ident).join(", ")}) VALUES (${vals.join(", ")}) RETURNING ${cols(st.returning ?? "*")}`;
            } else if (st.op === "update") {
              const sets = Object.keys(st.values).map((k) => `${ident(k)} = ${p(st.values[k])}`);
              const where = st.where.map((f) => f());
              text = `UPDATE ${t} SET ${sets.join(", ")}${where.length ? " WHERE " + where.join(" AND ") : ""} RETURNING ${cols(st.returning ?? "id")}`;
            } else {
              const where = st.where.map((f) => f());
              text = `SELECT ${cols(st.cols)} FROM ${t}${where.length ? " WHERE " + where.join(" AND ") : ""}${st.orders.length ? " ORDER BY " + st.orders.join(", ") : ""}`;
            }
            log.push(text);
            try {
              const rows = (await run(text, params)).map(row2json);
              if (st.one === "single") {
                if (rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
                return { data: rows[0], error: null };
              }
              if (st.one === "maybe") {
                if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
                return { data: rows[0] ?? null, error: null };
              }
              return { data: rows, error: null };
            } catch (e) {
              return { data: null, error: { code: e.code, message: e.message } };
            }
          })().then(resolveFn, rejectFn);
        },
      };
      return q;
    },
  };
}

try {
  // ------------------------------------------------------------- cluster
  stop();
  mkdirSync(DIR, { recursive: true });
  chownSync(DIR, 65534, 65534);
  asPg("initdb", ["-D", `${DIR}/data`, "-U", "postgres", "-A", "trust", "--no-sync"]);
  asPg("pg_ctl", ["-D", `${DIR}/data`, "-l", `${DIR}/log`, "-o", `-p ${PORT} -k ${DIR} -c listen_addresses=127.0.0.1`, "-w", "start"]);
  sql = postgres({ host: "127.0.0.1", port: PORT, user: "postgres", database: "postgres", max: 24, onnotice: () => {} });

  const migration = readFileSync("supabase/migrations/20260926220000_resume_tokens_and_duration.sql", "utf8");
  const ddl = migration.match(/CREATE TABLE IF NOT EXISTS public\.application_resume_tokens \([\s\S]*?\n\);/)[0];
  await sql.unsafe("CREATE TABLE public.applications (id uuid PRIMARY KEY)");
  await sql.unsafe(ddl);
  const APP = "11111111-1111-4111-8111-111111111111";
  await sql`INSERT INTO public.applications (id) VALUES (${APP})`;

  await build({
    entryPoints: ["src/lib/resume-tokens.server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "tokens.mjs"),
    alias: { "@": resolve("src") },
    logLevel: "silent",
  });
  const tokens = await import(pathToFileURL(join(out, "tokens.mjs")).href);
  const log = [];
  const admin = adapter((text, params) => sql.unsafe(text, params), log);
  const rowOf = async (raw) =>
    (await sql`SELECT * FROM public.application_resume_tokens WHERE token_hash = ${createHash("sha256").update(raw).digest("hex")}`)[0];

  // -------------------------------------------------- 1. lock-level proof
  {
    const raw = await tokens.issueResumeToken(admin, APP, { recovery: true });
    const row = await rowOf(raw);
    const a = await sql.reserve();
    const b = await sql.reserve();
    const claimOn = (conn) =>
      adapter((text, params) => conn.unsafe(text, params))
        .from("application_resume_tokens")
        .update({ revoked_at: new Date().toISOString(), last_used_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("id");
    await a.unsafe("BEGIN");
    const first = await claimOn(a);
    assert.equal(first.data.length, 1);
    let bDone = false;
    const second = claimOn(b).then((r) => {
      bDone = true;
      return r;
    });
    await sleep(400);
    assert.equal(bDone, false, "the second claim did not wait for the first one's row lock");
    await a.unsafe("COMMIT");
    const r2 = await second;
    assert.equal(r2.error, null);
    assert.equal(r2.data.length, 0, "the second claim also consumed the token");
    a.release();
    b.release();
    ok("real Postgres: the claim UPDATE blocks on the row lock and re-checks revoked_at, so the loser gets 0 rows");
  }

  // ------------------------------------- 2. exchangeResumeToken, concurrent
  {
    for (let round = 0; round < 5; round += 1) {
      const raw = await tokens.issueResumeToken(admin, APP, { recovery: true });
      const before = Number((await sql`SELECT count(*) FROM public.application_resume_tokens`)[0].count);
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => tokens.exchangeResumeToken(admin, raw)));
      const wins = results.filter((x) => x.status === "fulfilled");
      assert.equal(wins.length, 1, `round ${round}: ${wins.length} successful exchanges`);
      for (const loss of results.filter((x) => x.status === "rejected")) assert.match(loss.reason.message, /no longer valid/);
      const after = Number((await sql`SELECT count(*) FROM public.application_resume_tokens`)[0].count);
      assert.equal(after - before, 1, "exactly one session token was minted");
      assert.ok((await rowOf(raw)).revoked_at, "the recovery token is consumed");
      assert.equal(await tokens.resolveResumeToken(admin, wins[0].value), APP);
    }
    ok("real Postgres: 20 concurrent exchanges of one recovery link, 5 rounds, exactly one session each time");
  }

  // ------------------------------------------- 3. TTLs, hashing, expiry
  {
    const recovery = await tokens.issueResumeToken(admin, APP, { recovery: true });
    const session = await tokens.issueResumeToken(admin, APP);
    const r = await rowOf(recovery);
    const s = await rowOf(session);
    assert.equal(r.expires_at - r.created_at, 30 * 60_000);
    assert.equal(s.expires_at - s.created_at, 14 * 86400_000);
    const dump = JSON.stringify(await sql`SELECT * FROM public.application_resume_tokens`);
    assert.ok(!dump.includes(recovery) && !dump.includes(session), "a raw token is stored");
    assert.match(r.token_hash, /^[0-9a-f]{64}$/);
    await sql`UPDATE public.application_resume_tokens SET expires_at = now() - interval '1 second' WHERE id = ${r.id}`;
    await sql`UPDATE public.application_resume_tokens SET expires_at = now() - interval '1 second' WHERE id = ${s.id}`;
    await assert.rejects(tokens.exchangeResumeToken(admin, recovery), /no longer valid/);
    await assert.rejects(tokens.resolveResumeToken(admin, session), /no longer valid/);
    ok("real Postgres: 30-minute recovery / 14-day session lifetimes, hash-only storage, expiry enforced server-side");
  }

  // ------------------------------- 4. recovery requests keep the session
  {
    const session = await tokens.issueResumeToken(admin, APP);
    for (let i = 0; i < 10; i += 1) await tokens.issueResumeToken(admin, APP, { recovery: true });
    assert.equal((await rowOf(session)).revoked_at, null);
    assert.equal(await tokens.resolveResumeToken(admin, session), APP);
    const liveRecovery = await sql`
      SELECT count(*)::int AS n FROM public.application_resume_tokens
      WHERE application_id = ${APP} AND revoked_at IS NULL AND expires_at > now()
        AND expires_at - created_at <= interval '1 hour'`;
    assert.equal(liveRecovery[0].n, tokens.MAX_LIVE_TOKENS);
    ok("real Postgres: ten recovery requests leave the open session valid; recovery cap holds at 5");
  }

  assert.ok(log.some((t) => /^UPDATE .* WHERE "id" = \$\d+ AND "revoked_at" IS NULL AND "expires_at" > \$\d+ RETURNING "id"$/.test(t)));
  ok("the exchange claim ran as one conditional UPDATE ... RETURNING");
} finally {
  await sql?.end({ timeout: 1 }).catch(() => {});
  stop();
  rmSync(out, { recursive: true, force: true });
}
console.log(`${passed} resume-token Postgres checks passed (PostgreSQL ${PORT}, adapter in place of PostgREST)`);
