/** Card-link scope on the real 7-column table shape. No network and no database. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = "11111111-1111-4111-8111-111111111111";
const out = mkdtempSync(join(tmpdir(), "rr-card-scope-"));
await build({
  entryPoints: ["src/lib/resume-tokens.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(out, "tokens.mjs"),
  alias: { "@": resolve("src") },
});
const tokens = await import(pathToFileURL(join(out, "tokens.mjs")).href);

function createAdmin() {
  const rows = [];
  let seq = 0;
  let clock = Date.parse("2026-10-21T15:00:00.000Z");
  const stamp = () => new Date((clock += 1000)).toISOString();
  const from = () => {
    const state = { filters: [], orders: [], op: "read", values: null, one: false, cols: "*" };
    const run = () => {
      if (state.cols.includes("purpose")) {
        return { data: null, error: { code: "42703", message: "column purpose does not exist" } };
      }
      if (state.op === "insert" && state.values && Object.prototype.hasOwnProperty.call(state.values, "purpose")) {
        return {
          data: null,
          error: { code: "PGRST204", message: "Could not find the 'purpose' column of 'application_resume_tokens' in the schema cache" },
        };
      }
      let matched = rows.filter((row) => state.filters.every((filter) => filter(row)));
      if (state.op === "insert") {
        const row = {
          id: `tok-${String(++seq).padStart(4, "0")}`,
          created_at: stamp(),
          revoked_at: null,
          last_used_at: null,
          ...state.values,
        };
        rows.push(row);
        matched = [row];
      }
      if (state.op === "update") {
        for (const row of matched) Object.assign(row, state.values);
      }
      for (const spec of [...state.orders].reverse()) {
        matched.sort((a, b) => {
          if (a[spec.key] < b[spec.key]) return spec.asc ? -1 : 1;
          if (a[spec.key] > b[spec.key]) return spec.asc ? 1 : -1;
          return 0;
        });
      }
      return { data: state.one ? (matched[0] ?? null) : matched.map((row) => ({ ...row })), error: null };
    };
    const query = {
      select(cols = "*") { state.cols = String(cols); return query; },
      eq(key, value) { state.filters.push((row) => row[key] === value); return query; },
      is(key, value) { state.filters.push((row) => (row[key] ?? null) === value); return query; },
      in(key, value) { state.filters.push((row) => value.includes(row[key])); return query; },
      gt(key, value) { state.filters.push((row) => row[key] > value); return query; },
      order(key, opts) { state.orders.push({ key, asc: opts?.ascending !== false }); return query; },
      insert(values) { state.op = "insert"; state.values = values; return query; },
      update(values) { state.op = "update"; state.values = values; return query; },
      single() { state.one = true; return query; },
      maybeSingle() { state.one = true; return query; },
      then(ok, fail) { return Promise.resolve().then(run).then(ok, fail); },
    };
    return query;
  };
  return { from, rows };
}

const live = (admin, kind) => admin.rows.filter((row) => !row.revoked_at && tokens.isCardRow(row) === (kind === "card"));
let passed = 0;
function ok(name) {
  passed += 1;
  console.log("PASS", name);
}

{
  const admin = createAdmin();
  const card = await tokens.issueResumeToken(admin, APP, { purpose: "card", ttlMs: tokens.CARD_LINK_MS });
  const resume = await tokens.issueResumeToken(admin, APP);
  assert.equal(card.startsWith(tokens.CARD_TOKEN_PREFIX), true);
  assert.equal(resume.startsWith(tokens.CARD_TOKEN_PREFIX), false);
  const cardRow = admin.rows.find((row) => tokens.isCardRow(row));
  assert.equal(new Date(cardRow.expires_at).getTime() - new Date(cardRow.created_at).getTime(), tokens.CARD_LINK_MS);
  assert.equal(Object.hasOwn(cardRow, "purpose"), false);
  await assert.rejects(tokens.exchangeResumeToken(admin, card), /no longer valid/);
  await assert.rejects(tokens.resolveResumeToken(admin, card), /no longer valid/);
  await assert.rejects(tokens.resolveCardToken(admin, resume), /no longer valid/);
  assert.equal(await tokens.resolveCardToken(admin, card), APP);
  assert.equal(await tokens.resolveResumeToken(admin, resume), APP);
  ok("on the real schema a card link issues, thank-you and the wizard reject it, and a resume token is rejected at /card");
}

{
  const admin = createAdmin();
  await assert.rejects(
    tokens.issueResumeToken(admin, APP, { purpose: "card", ttlMs: 30 * 60_000 }),
    /longer than one hour/,
  );
  assert.equal(admin.rows.length, 0);
  ok("a card link at or under the recovery window is refused");
}

{
  const admin = createAdmin();
  const resumes = [];
  for (let i = 0; i < 5; i += 1) resumes.push(await tokens.issueResumeToken(admin, APP));
  const card = await tokens.issueResumeToken(admin, APP, { purpose: "card" });
  const again = await tokens.issueResumeToken(admin, APP, { purpose: "card" });
  assert.equal(again, card);
  assert.equal(live(admin, "card").length, 1);
  assert.equal(live(admin, "resume").length, 5);
  for (const raw of resumes) assert.equal(await tokens.resolveResumeToken(admin, raw), APP);
  await assert.rejects(tokens.exchangeResumeToken(admin, card), /no longer valid/);
  await assert.rejects(tokens.resolveResumeToken(admin, card), /no longer valid/);
  assert.equal(await tokens.resolveCardToken(admin, card), APP);
  const cardRow = admin.rows.find((row) => tokens.isCardRow(row));
  assert.equal(new Date(cardRow.expires_at).getTime() - new Date(cardRow.created_at).getTime(), tokens.CARD_LINK_MS);
  assert.ok(tokens.CARD_LINK_MS > 60 * 60_000);
  ok("a card link is reused for 72 hours and does not revoke resume links");
}

{
  const admin = createAdmin();
  const resume = await tokens.issueResumeToken(admin, APP);
  let previous = null;
  for (let i = 0; i < 6; i += 1) {
    if (previous) previous.token_hash = `stale-${i}`;
    await tokens.issueResumeToken(admin, APP, { purpose: "card" });
    previous = admin.rows.filter((row) => tokens.isCardRow(row)).at(-1);
  }
  assert.equal(admin.rows.find((row) => !tokens.isCardRow(row)).revoked_at, null);
  assert.equal(await tokens.resolveResumeToken(admin, resume), APP);
  assert.equal(admin.rows.filter((row) => tokens.isCardRow(row) && row.revoked_at).length >= 1, true);
  assert.ok(live(admin, "card").length <= 5);
  ok("extra card links trim card links only");
}

{
  const admin = createAdmin();
  const [first, second] = await Promise.all([
    tokens.issueResumeToken(admin, APP, { purpose: "card" }),
    tokens.issueResumeToken(admin, APP, { purpose: "card" }),
  ]);
  assert.equal(first, second);
  assert.equal(live(admin, "card").length, 1);
  ok("two card issues at once share one token");
}

rmSync(out, { recursive: true, force: true });
console.log(`${passed} card-link scope checks passed`);
