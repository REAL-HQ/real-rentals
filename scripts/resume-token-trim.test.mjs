/**
 * Per-kind token trimming (PR 4). No network and no database: the real
 * resume-tokens.server.ts runs against an in-memory application_resume_tokens
 * table that behaves like PostgREST for the calls it makes.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const out = mkdtempSync(join(tmpdir(), "rr-token-trim-"));
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

/** created_at defaults to the real clock, as the column default does. */
function createAdmin() {
  const rows = [];
  let seq = 0;
  const from = (table) => {
    assert.equal(table, "application_resume_tokens");
    const state = { filters: [], orders: [], op: "read", values: null, one: false };
    const run = () => {
      let matched = rows.filter((row) => state.filters.every((f) => f(row)));
      if (state.op === "insert") {
        const row = {
          id: `tok-${String(++seq).padStart(4, "0")}`,
          created_at: new Date().toISOString(),
          revoked_at: null,
          last_used_at: null,
          ...state.values,
        };
        rows.push(row);
        matched = [row];
      }
      if (state.op === "update") for (const row of matched) Object.assign(row, state.values);
      for (const spec of [...state.orders].reverse()) {
        matched.sort((a, b) => (a[spec.key] < b[spec.key] ? (spec.asc ? -1 : 1) : a[spec.key] > b[spec.key] ? (spec.asc ? 1 : -1) : 0));
      }
      return { data: state.one ? (matched[0] ?? null) : matched.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select() { return q; },
      eq(k, v) { state.filters.push((r) => r[k] === v); return q; },
      is(k, v) { state.filters.push((r) => (r[k] ?? null) === v); return q; },
      in(k, v) { state.filters.push((r) => v.includes(r[k])); return q; },
      gt(k, v) { state.filters.push((r) => r[k] > v); return q; },
      order(k, o) { state.orders.push({ key: k, asc: o?.ascending !== false }); return q; },
      insert(v) { state.op = "insert"; state.values = v; return q; },
      update(v) { state.op = "update"; state.values = v; return q; },
      single() { state.one = true; return q; },
      maybeSingle() { state.one = true; return q; },
      then(ok, fail) { return Promise.resolve().then(run).then(ok, fail); },
    };
    return q;
  };
  return { from, rows };
}

const liveOf = (admin, kind, app = APP) =>
  admin.rows.filter(
    (r) =>
      r.application_id === app &&
      !r.revoked_at &&
      Date.parse(r.expires_at) > Date.now() &&
      tokens.tokenKindOf(r) === kind,
  );
const rowFor = async (admin, raw) => {
  const hash = await tokens.hashResumeToken(raw);
  return admin.rows.find((r) => r.token_hash === hash);
};

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log("PASS", name);
};

{
  const now = Date.now();
  const at = (ms) => new Date(now + ms).toISOString();
  assert.equal(tokens.tokenKindOf({ created_at: at(0), expires_at: at(30 * 60_000) }), "recovery");
  assert.equal(tokens.tokenKindOf({ created_at: at(0), expires_at: at(60 * 60_000) }), "recovery");
  assert.equal(tokens.tokenKindOf({ created_at: at(0), expires_at: at(tokens.CARD_LINK_MS) }), "card");
  assert.equal(tokens.tokenKindOf({ created_at: at(0), expires_at: at(14 * 86400_000) }), "session");
  ok("token kind is read from lifetime: recovery <= 1h, card = 72h, session otherwise");
}

{
  const admin = createAdmin();
  const session = await tokens.issueResumeToken(admin, APP);
  for (let i = 0; i < 12; i += 1) await tokens.issueResumeToken(admin, APP, { recovery: true });
  const sessionRow = await rowFor(admin, session);
  assert.equal(sessionRow.revoked_at, null, "a recovery mint revoked the session token");
  assert.equal(await tokens.resolveResumeToken(admin, session), APP);
  assert.equal(liveOf(admin, "session").length, 1);
  assert.equal(liveOf(admin, "recovery").length, tokens.MAX_LIVE_TOKENS);
  ok("twelve recovery requests never revoke the live session token; recovery cap still holds at 5");
}

{
  const admin = createAdmin();
  const sessions = [];
  for (let i = 0; i < 7; i += 1) sessions.push(await tokens.issueResumeToken(admin, APP));
  assert.equal(liveOf(admin, "session").length, tokens.MAX_LIVE_TOKENS);
  // The two oldest are the ones retired.
  assert.ok((await rowFor(admin, sessions[0])).revoked_at);
  assert.ok((await rowFor(admin, sessions[1])).revoked_at);
  for (const raw of sessions.slice(2)) assert.equal(await tokens.resolveResumeToken(admin, raw), APP);
  ok("the per-kind session cap still holds: the oldest session tokens are revoked past 5");
}

{
  const admin = createAdmin();
  const recoveries = [];
  for (let i = 0; i < 5; i += 1) recoveries.push(await tokens.issueResumeToken(admin, APP, { recovery: true }));
  for (let i = 0; i < 7; i += 1) await tokens.issueResumeToken(admin, APP);
  for (const raw of recoveries) assert.equal((await rowFor(admin, raw)).revoked_at, null);
  assert.equal(liveOf(admin, "recovery").length, 5);
  ok("session mints trim session tokens only, never outstanding recovery links");
}

{
  const admin = createAdmin();
  // Four stale session rows: expired, never revoked.
  const past = Date.now() - 20 * 86400_000;
  for (let i = 0; i < 4; i += 1) {
    admin.rows.push({
      id: `old-${i}`,
      application_id: APP,
      token_hash: `stale-${i}`,
      created_at: new Date(past + i).toISOString(),
      expires_at: new Date(past + i + 14 * 86400_000).toISOString(),
      revoked_at: null,
    });
  }
  const live = [];
  for (let i = 0; i < 4; i += 1) live.push(await tokens.issueResumeToken(admin, APP));
  for (const raw of live) assert.equal(await tokens.resolveResumeToken(admin, raw), APP);
  assert.equal(liveOf(admin, "session").length, 4);
  ok("expired-but-unrevoked tokens do not count toward the cap (4 stale + 4 live revokes nothing)");
}

{
  const admin = createAdmin();
  const session = await tokens.issueResumeToken(admin, APP);
  const recovery = await tokens.issueResumeToken(admin, APP, { recovery: true });
  const exchanged = await tokens.exchangeResumeToken(admin, recovery);
  assert.notEqual(exchanged, recovery);
  assert.equal(await tokens.resolveResumeToken(admin, session), APP);
  assert.equal(await tokens.resolveResumeToken(admin, exchanged), APP);
  await assert.rejects(tokens.exchangeResumeToken(admin, recovery), /no longer valid/);
  ok("recovery stays single-use and its exchange keeps the existing session alive");
}

{
  const admin = createAdmin();
  const mine = await tokens.issueResumeToken(admin, APP);
  for (let i = 0; i < 8; i += 1) await tokens.issueResumeToken(admin, OTHER, { recovery: true });
  for (let i = 0; i < 8; i += 1) await tokens.issueResumeToken(admin, OTHER);
  assert.equal((await rowFor(admin, mine)).revoked_at, null);
  ok("trimming is scoped to one application");
}

{
  const admin = createAdmin();
  const session = await tokens.issueResumeToken(admin, APP);
  const recovery = await tokens.issueResumeToken(admin, APP, { recovery: true });
  for (let i = 0; i < 7; i += 1) await tokens.issueResumeToken(admin, APP, { purpose: "card" }).then(() => {
    // force a fresh card mint each round
    const card = admin.rows.filter((r) => tokens.isCardRow(r)).at(-1);
    if (card) card.token_hash = `rotated-${i}`;
  });
  assert.equal((await rowFor(admin, session)).revoked_at, null);
  assert.equal((await rowFor(admin, recovery)).revoked_at, null);
  assert.ok(liveOf(admin, "card").length <= tokens.MAX_LIVE_TOKENS);
  ok("card mints trim card links only");
}

{
  const src = readFileSync("src/lib/resume-tokens.server.ts", "utf8");
  const trim = src.slice(src.indexOf("async function trimLiveTokens"), src.indexOf("/** The expiry this process remembers"));
  assert.match(trim, /\.gt\("expires_at"/);
  assert.match(trim, /tokenKindOf\(row\) === kind/);
  assert.doesNotMatch(trim, /isCardRow\(row\) === \(kind === "card"\)/);
  ok("source: trim filters out expired rows and compares a three-way kind");
}

rmSync(out, { recursive: true, force: true });
console.log(`${passed} resume-token trim checks passed`);
