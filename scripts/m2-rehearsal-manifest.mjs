// Deterministic execution manifest for the checksum-gated M2 rehearsal.
//
// Lists every file the rehearsal executes, in order, with the SHA-256 of the
// repo bytes and the SHA-256 of the exact bytes that will be executed after the
// one transformation (if any) named for that file. Nothing here touches a
// database. The in-database executor must reproduce each executed hash
// independently before it runs anything; two implementations agreeing is the
// determinism proof.
//
// Transformations — the only two, each total and checked:
//   strip_txn   remove exactly one top-level `BEGIN;` line and one `COMMIT;`
//               line. Used where the runbook says "own BEGIN/COMMIT": the
//               executor runs each file as one transaction, so semantics match.
//   cron_block  replace exactly one `cron.schedule(` with
//               `rehearsal.cron_schedule_blocked(`. The stub records the job and
//               schedules nothing. Used on the eight files whose job bodies POST
//               to drivereal.com.
//
//   node scripts/m2-rehearsal-manifest.mjs            # print summary
//   node scripts/m2-rehearsal-manifest.mjs --write    # write the JSON + verify files
//   node scripts/m2-rehearsal-manifest.mjs --check    # fail if anything drifted
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { stepQuery } from "./m2-step29-after-step25.mjs";
import { baselineOrder } from "./m2-rehearsal-order.mjs";

const OUT = "proposed/rehearsal/manifest.json";
const VERIFY_DIR = "proposed/rehearsal/verify";
const PRESTEP_SMS = "proposed/rehearsal/presteps/0039-sms-consent.sql";
const PRESTEP_SMS_SQL =
  "-- Rehearsal-only prestep, run immediately before baseline seq 39.\n" +
  "-- Seq 39 (20260721192708_1efcc7f8) grants INSERT on applications.sms_consent,\n" +
  "-- which seq 44 (20260722205426_c7483f5d) adds. This is seq 44's own\n" +
  "-- definition, verbatim, so seq 44 becomes a no-op for this column exactly as\n" +
  "-- it is in production. No migration file is modified.\n" +
  "ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS sms_consent boolean DEFAULT false;\n";

// The eight production-targeting cron files, by repo filename.
const CRON_FILES = new Set([
  "20260722235626_0c2a4606-69bc-4371-b82d-de52b351e7ac.sql",
  "20260722235657_f2c6714d-16f7-4b08-9114-676af87ffed4.sql",
  "20260815153000_4b3d85d0-a634-441c-b358-bd1b52b7550c.sql",
  "20260921120000_fleet_ops_foundation.sql",
  "20260921200000_charges_incidents_deposits.sql",
  "20260925130510_a3a91f8e-acb2-4d28-bef6-2e65667713f8.sql",
  "20260925130550_39538d51-c101-4f3e-bdfd-16daa1e9294a.sql",
  "20261005060239_93581d0b-f7c5-416a-8b96-60770d1e64c2.sql",
]);

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export function stripTxn(text, path) {
  const lines = text.split("\n");
  const b = lines.flatMap((l, i) => (/^\s*BEGIN\s*;\s*$/i.test(l) ? [i] : []));
  const c = lines.flatMap((l, i) => (/^\s*COMMIT\s*;\s*$/i.test(l) ? [i] : []));
  if (b.length !== 1 || c.length !== 1) throw new Error(`${path}: strip_txn needs exactly one BEGIN; and one COMMIT; (got ${b.length}/${c.length})`);
  if (b[0] > c[0]) throw new Error(`${path}: COMMIT precedes BEGIN`);
  return lines.filter((_, i) => i !== b[0] && i !== c[0]).join("\n");
}

export function outboundBlock(text, path) {
  // One uniform rule for every replayed file that can reach production:
  // scheduling and HTTP calls are replaced by recording stubs. The same three
  // literal substitutions are applied, in this order, by the in-database
  // executor; the resulting hashes must agree.
  if (!text.includes("drivereal.com")) throw new Error(`${path}: expected a drivereal.com target`);
  const subs = [["cron.schedule(", "rehearsal.cron_schedule_blocked("],
                ["net.http_post(", "rehearsal.http_post_blocked("],
                ["extensions.http_post(", "rehearsal.http_post_blocked("]];
  let out = text, n = 0;
  for (const [a, b] of subs) { n += out.split(a).length - 1; out = out.split(a).join(b); }
  if (n < 1) throw new Error(`${path}: outbound_block made no substitution`);
  // Any surviving *call* fails closed, including whitespace before the paren.
  // Mentions in comments (e.g. "it referenced net.http_post in public") are not calls.
  for (const bad of [/\bcron\.schedule\s*\(/, /\bnet\.http_\w+\s*\(/, /\bextensions\.http_\w+\s*\(/]) {
    if (bad.test(out)) throw new Error(`${path}: a call matching ${bad} survived`);
  }
  return out;
}

function entry(kind, path, transform, extra = {}) {
  const original = readFileSync(path, "utf8");
  const executed = transform === "strip_txn" ? stripTxn(original, path)
    : transform === "outbound_block" ? outboundBlock(original, path)
    : original;
  return { kind, path, transform, sha256: sha(original), executed_sha256: sha(executed), bytes: Buffer.byteLength(original), ...extra };
}

/** HOSTED-INSTALL order table: step, file, own-transaction?, rollback. */
function orderTable(runbook) {
  const body = runbook.slice(runbook.indexOf("## Order"), runbook.indexOf("### Step 1"));
  const rows = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|[^|]*\|\s*`([^`]+)`\s*\|/);
    if (m) rows.push({ step: Number(m[1]), file: m[2], own: /\bown\b/.test(m[3]), rollback: m[4] });
  }
  if (rows.length !== 29 || rows.some((r, i) => r.step !== i + 1)) throw new Error(`order table: expected steps 1..29, got ${rows.length}`);
  return rows;
}

export function build() {
  const runbook = readFileSync("proposed/HOSTED-INSTALL.md", "utf8");
  const out = [];
  for (const r of baselineOrder().rows) {
    const text = readFileSync(r.path, "utf8");
    const outbound = /cron\.schedule\(|http_post\(/.test(text);
    const own = /^\s*BEGIN\s*;\s*$/im.test(text);
    if (outbound && own) throw new Error(`${r.path}: both transforms would apply`);
    out.push(entry(r.ledger === "drizzle" ? "drizzle" : "migration", r.path, outbound ? "outbound_block" : own ? "strip_txn" : "none", { ledger: r.ledger, key: r.key, provenance: r.provenance }));
  }
  out.push(entry("query", "proposed/m2-preflight.sql", "none", { expect: "preflight: zero rows WHERE ok IS NOT TRUE" }));
  for (const r of orderTable(runbook)) {
    out.push(entry("packet", r.file, r.own ? "strip_txn" : "none", { step: r.step }));
    out.push(entry("verify", `${VERIFY_DIR}/step-${String(r.step).padStart(2, "0")}.sql`, "none", { step: r.step, expect: "t" }));
  }
  out.push(entry("verify", "proposed/m2-verify/step29-after-step25.sql", "none", { expect: "t (reduced path only)" }));
  out.push(entry("verify", "proposed/m2-verify/no-executor-create.sql", "none", { expect: "t" }));
  out.push(entry("query", "proposed/backfill-document-content-sha.sql", "none", { expect: "missing=0 and mismatched=0" }));
  for (const r of orderTable(runbook).slice().reverse()) {
    out.push(entry("rollback", r.rollback, "strip_txn", { step: r.step }));
  }
  const ob = out.filter((e) => e.transform === "outbound_block").length;
  if (ob !== 8) throw new Error(`expected 8 outbound_block entries, got ${ob}`);
  out.forEach((e, i) => { e.ord = i + 1; });
  const names = out.map((e) => e.path);
  const dup = names.filter((n, i) => names.indexOf(n) !== i && !n.startsWith(VERIFY_DIR));
  if (dup.length) throw new Error(`duplicate entries: ${dup.join(", ")}`);
  return out;
}

function writeVerifyFiles() {
  const runbook = readFileSync("proposed/HOSTED-INSTALL.md", "utf8");
  mkdirSync(VERIFY_DIR, { recursive: true });
  for (let s = 1; s <= 29; s++) {
    const p = `${VERIFY_DIR}/step-${String(s).padStart(2, "0")}.sql`;
    writeFileSync(p, `-- GENERATED verbatim from proposed/HOSTED-INSTALL.md, Step ${s}. Do not edit.\n${stepQuery(runbook, s)}\n`);
  }
}

const direct = process.argv[1] && process.argv[1].endsWith("m2-rehearsal-manifest.mjs");
if (direct) {
  if (process.argv.includes("--write")) {
    writeVerifyFiles();
    writeFileSync(OUT, JSON.stringify(build(), null, 1) + "\n");
    console.log(`wrote ${OUT}`);
  } else if (process.argv.includes("--check")) {
    if (!existsSync(OUT)) throw new Error(`${OUT} missing`);
    const want = JSON.stringify(build(), null, 1) + "\n";
    if (readFileSync(OUT, "utf8") !== want) { console.error(`${OUT} has drifted`); process.exit(1); }
    console.log(`${OUT} matches the repo`);
  }
  const m = build();
  const by = (k) => m.filter((e) => e.kind === k).length;
  const tr = (t) => m.filter((e) => e.transform === t).length;
  console.log(`entries=${m.length} migrations=${by("migration")} drizzle=${by("drizzle")} packet=${by("packet")} verify=${by("verify")} rollback=${by("rollback")} query=${by("query")}`);
  console.log(`transforms: none=${tr("none")} strip_txn=${tr("strip_txn")} outbound_block=${tr("outbound_block")}  total bytes=${m.reduce((a, e) => a + e.bytes, 0)}`);
}
