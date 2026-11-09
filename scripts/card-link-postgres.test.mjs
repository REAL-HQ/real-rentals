/**
 * Card links against a throwaway Postgres and the real 7-column
 * application_resume_tokens table. Never reads production env and never
 * opens a hosted database.
 *
 * Run: node scripts/card-link-postgres.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

function pgBindir() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const result = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  const dir = result.stdout?.trim();
  if (result.status !== 0 || !dir) {
    throw new Error(`pg_config --bindir failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return dir;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("No free port")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

const BIN = pgBindir();
const DIR = mkdtempSync(join(tmpdir(), "rr-card-link-pg-"));
const PORT = await freePort();
const SOCKET = join(DIR, "socket");
const APP = "11111111-1111-4111-8111-111111111111";

function pg(bin, args) {
  const result = spawnSync(join(BIN, bin), args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${bin} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function ident(name) {
  if (!/^[a-z_]+$/.test(name)) throw new Error(`bad identifier ${name}`);
  return `"${name}"`;
}

function present(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function admin(sql) {
  return {
    from(table) {
      if (table !== "application_resume_tokens") throw new Error(`unexpected table ${table}`);
      const state = {
        op: "select",
        cols: "*",
        filters: [],
        orders: [],
        values: null,
        one: false,
      };
      const query = {
        select(cols = "*") {
          state.cols = String(cols);
          return query;
        },
        eq(key, value) {
          state.filters.push({ op: "eq", key, value });
          return query;
        },
        is(key, value) {
          state.filters.push({ op: "is", key, value });
          return query;
        },
        in(key, value) {
          state.filters.push({ op: "in", key, value });
          return query;
        },
        gt(key, value) {
          state.filters.push({ op: "gt", key, value });
          return query;
        },
        order(key, opts) {
          state.orders.push({ key, asc: opts?.ascending !== false });
          return query;
        },
        insert(values) {
          state.op = "insert";
          state.values = values;
          return query;
        },
        update(values) {
          state.op = "update";
          state.values = values;
          return query;
        },
        single() {
          state.one = true;
          return query;
        },
        maybeSingle() {
          state.one = true;
          return query;
        },
        then(ok, fail) {
          return run(sql, state).then(ok, fail);
        },
      };
      return query;
    },
  };
}

function where(state, params) {
  return state.filters
    .map((filter) => {
      const col = ident(filter.key);
      if (filter.op === "eq") {
        params.push(filter.value);
        return `${col} = $${params.length}`;
      }
      if (filter.op === "gt") {
        params.push(filter.value);
        return `${col} > $${params.length}`;
      }
      if (filter.op === "is") {
        if (filter.value !== null) throw new Error("only IS NULL is used");
        return `${col} is null`;
      }
      if (filter.op === "in") {
        const items = Array.isArray(filter.value) ? filter.value : [];
        if (!items.length) return "false";
        const marks = items.map((item) => {
          params.push(item);
          return `$${params.length}`;
        });
        return `${col} in (${marks.join(", ")})`;
      }
      throw new Error(`unexpected filter ${filter.op}`);
    })
    .join(" and ");
}

function returning(cols) {
  if (!cols || cols === "*") return "*";
  return cols.split(",").map((col) => ident(col.trim())).join(", ");
}

async function run(sql, state) {
  const params = [];
  const clause = where(state, params);
  const order = state.orders.length
    ? ` order by ${state.orders.map((item) => `${ident(item.key)} ${item.asc ? "asc" : "desc"}`).join(", ")}`
    : "";
  let text;
  if (state.op === "insert") {
    const keys = Object.keys(state.values);
    const cols = keys.map(ident).join(", ");
    const marks = keys.map((key) => {
      params.push(state.values[key]);
      return `$${params.length}`;
    });
    text = `insert into application_resume_tokens (${cols}) values (${marks.join(", ")}) returning ${returning(state.cols)}`;
  } else if (state.op === "update") {
    const sets = Object.keys(state.values).map((key) => {
      params.push(state.values[key]);
      return `${ident(key)} = $${params.length}`;
    });
    text = `update application_resume_tokens set ${sets.join(", ")}`;
    if (clause) text += ` where ${clause}`;
    text += ` returning ${returning(state.cols)}`;
  } else {
    text = `select ${returning(state.cols)} from application_resume_tokens`;
    if (clause) text += ` where ${clause}`;
    text += order;
  }
  try {
    const rows = (await sql.unsafe(text, params)).map(present);
    if (state.one) {
      if (rows.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  } catch (error) {
    return { data: null, error: { message: error.message, code: error.code } };
  }
}

let failed = null;
let sql;
try {
  mkdirSync(SOCKET, { recursive: true });
  pg("initdb", ["-D", join(DIR, "data"), "-U", "postgres", "-A", "trust"]);
  pg("pg_ctl", [
    "-D", join(DIR, "data"),
    "-l", join(DIR, "log"),
    "-w",
    "-o", `-p ${PORT} -k ${SOCKET} -c listen_addresses=`,
    "start",
  ]);
  sql = postgres({
    host: SOCKET,
    port: PORT,
    database: "postgres",
    username: "postgres",
    max: 1,
  });
  await sql.unsafe("create database cardlink");
  await sql.end({ timeout: 1 });
  const db = postgres({
    host: SOCKET,
    port: PORT,
    database: "cardlink",
    username: "postgres",
    max: 4,
  });
  try {
    await db.unsafe(`
      create table public.applications (
        id uuid primary key
      );
      create table public.application_resume_tokens (
        id uuid primary key default gen_random_uuid(),
        application_id uuid not null references public.applications(id) on delete cascade,
        token_hash text not null unique,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null,
        last_used_at timestamptz,
        revoked_at timestamptz
      );
    `);
    await db`insert into public.applications (id) values (${APP})`;
    const columns = await db`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'application_resume_tokens'
      order by column_name
    `;
    assert.deepEqual(columns.map((row) => row.column_name), [
      "application_id",
      "created_at",
      "expires_at",
      "id",
      "last_used_at",
      "revoked_at",
      "token_hash",
    ]);

    const out = mkdtempSync(join(tmpdir(), "rr-card-pg-"));
    await build({
      entryPoints: ["src/lib/resume-tokens.server.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: join(out, "tokens.mjs"),
      alias: { "@": resolve("src") },
    });
    const tokens = await import(pathToFileURL(join(out, "tokens.mjs")).href);
    const client = admin(db);

    const resumes = [];
    for (let i = 0; i < 5; i += 1) resumes.push(await tokens.issueResumeToken(client, APP));
    const card = await tokens.issueResumeToken(client, APP, { purpose: "card" });
    assert.equal(card.startsWith(tokens.CARD_TOKEN_PREFIX), true);
    assert.equal(resumes.some((raw) => raw.startsWith(tokens.CARD_TOKEN_PREFIX)), false);

    const [stored] = await db`
      select created_at, expires_at,
             (expires_at - created_at) = interval '72 hours' as exact
      from application_resume_tokens
      where expires_at - created_at = interval '72 hours'
    `;
    assert.equal(stored.exact, true);
    assert.equal(tokens.isCardRow(present(stored)), true);
    assert.equal(
      new Date(stored.expires_at).getTime() - new Date(stored.created_at).getTime(),
      tokens.CARD_LINK_MS,
    );

    await assert.rejects(tokens.exchangeResumeToken(client, card), /no longer valid/);
    await assert.rejects(tokens.resolveResumeToken(client, card), /no longer valid/);
    assert.equal(await tokens.resolveCardToken(client, card), APP);
    for (const raw of resumes) {
      assert.equal(await tokens.resolveResumeToken(client, raw), APP);
      await assert.rejects(tokens.resolveCardToken(client, raw), /no longer valid/);
    }

    const live = await db`
      select created_at, expires_at, revoked_at
      from application_resume_tokens
      where revoked_at is null
    `;
    const liveCards = live.filter((row) => tokens.isCardRow(present(row)));
    const liveResumes = live.filter((row) => !tokens.isCardRow(present(row)));
    assert.equal(liveCards.length, 1);
    assert.equal(liveResumes.length, 5);

    await tokens.issueResumeToken(client, APP);
    const after = await db`
      select created_at, expires_at, revoked_at
      from application_resume_tokens
    `;
    const revokedCards = after.filter((row) => row.revoked_at && tokens.isCardRow(present(row)));
    const liveAfter = after.filter((row) => !row.revoked_at);
    assert.equal(revokedCards.length, 0);
    assert.equal(liveAfter.filter((row) => tokens.isCardRow(present(row))).length, 1);
    assert.equal(liveAfter.filter((row) => !tokens.isCardRow(present(row))).length, 5);
    console.log("PASS card link on the real 7-column table, rejected at thank-you, cap stays separate");
    rmSync(out, { recursive: true, force: true });
  } finally {
    await db.end({ timeout: 1 });
  }
} catch (error) {
  failed = error;
} finally {
  try { await sql?.end({ timeout: 1 }); } catch { /* already closed */ }
  spawnSync(join(BIN, "pg_ctl"), ["-D", join(DIR, "data"), "-m", "immediate", "-w", "stop"], { encoding: "utf8" });
  rmSync(DIR, { recursive: true, force: true });
}
if (failed) throw failed;
