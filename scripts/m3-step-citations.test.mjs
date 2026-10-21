/**
 * M3 install citations must use the HOSTED-INSTALL step numbers in
 * proposed/m3/HOSTED-INSTALL.md. Verify and preflight files stay SELECT.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertReadQuery, assertSelectOnly as guardSelect } from "./select-only.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

function strip(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

function table(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\| (\d+) \| `([^`]+)` \|/);
    if (!match) continue;
    const paths = [...line.matchAll(/`([^`]+\.sql)`/g)].map((item) => item[1]);
    rows.push({
      step: Number(match[1]),
      file: match[2],
      verify: paths[1],
      rollback: paths[paths.length - 1],
    });
  }
  return rows;
}

function assertSelectOnly(file, text) {
  const check = file.endsWith("preflight.sql") ? guardSelect : assertReadQuery;
  try {
    check(text);
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : error}`);
  }
}

function scanCitations(name, text, byFile) {
  const stepAt = /HOSTED-INSTALL step (\d+)/g;
  for (const match of text.matchAll(stepAt)) {
    const step = Number(match[1]);
    const from = Math.max(0, match.index - 160);
    const to = Math.min(text.length, match.index + match[0].length + 160);
    const window = text.slice(from, to);
    const paths = [...window.matchAll(/proposed\/[A-Za-z0-9_./-]+\.sql/g)].map((item) => ({
      file: item[0],
      at: from + item.index,
    }));
    if (paths.length === 0) continue;
    paths.sort((a, b) => Math.abs(a.at - match.index) - Math.abs(b.at - match.index));
    const nearest = paths[0].file;
    const expected = byFile.get(nearest);
    if (expected != null && expected !== step) {
      throw new Error(`${name} cites HOSTED-INSTALL step ${step} next to ${nearest}, which is step ${expected}`);
    }
  }
}

const hosted = read("proposed/m3/HOSTED-INSTALL.md");
const rows = table(hosted);
if (rows.length !== 2) throw new Error(`HOSTED-INSTALL table has ${rows.length} rows`);
rows.forEach((row, index) => {
  if (row.step !== index + 1) throw new Error(`step ${row.step} is out of order`);
  if (row.file !== `proposed/m3-packet/0${row.step}-${row.step === 1 ? "tnc-approval-expiry" : "waitlist-coming-soon-rate"}.sql`) {
    throw new Error(`step ${row.step} file is ${row.file}`);
  }
  if (!row.verify.startsWith("proposed/m3-verify/")) throw new Error(`step ${row.step} verify is ${row.verify}`);
  if (!row.rollback.startsWith("proposed/m3-rollback/")) throw new Error(`step ${row.step} rollback is ${row.rollback}`);
});

const byFile = new Map(rows.map((row) => [row.file, row.step]));
if (byFile.get("proposed/m3-packet/01-tnc-approval-expiry.sql") !== 1) throw new Error("TNC file is not step 1");
if (byFile.get("proposed/m3-packet/02-waitlist-coming-soon-rate.sql") !== 2) throw new Error("rate file is not step 2");

const names = {
  "proposed/m3": ["HOSTED-INSTALL.md", "preflight.sql"],
  "proposed/m3-packet": ["01-tnc-approval-expiry.sql", "02-waitlist-coming-soon-rate.sql"],
  "proposed/m3-verify": ["01-tnc-approval-expiry.sql", "02-waitlist-coming-soon-rate.sql"],
  "proposed/m3-rollback": ["01-tnc-approval-expiry.sql", "02-waitlist-coming-soon-rate.sql"],
};
for (const [dir, expected] of Object.entries(names)) {
  const found = readdirSync(resolve(root, dir)).sort();
  if (found.join() !== expected.join()) throw new Error(`${dir} contains ${found.join(", ")}`);
}

for (const row of rows) {
  const apply = read(row.file);
  const verify = read(row.verify);
  const rollback = read(row.rollback);
  if (!apply.startsWith(`-- HOSTED-INSTALL step ${row.step}: ${row.file}`)) {
    throw new Error(`${row.file} header does not cite step ${row.step}`);
  }
  if (!verify.startsWith(`-- Verify for HOSTED-INSTALL step ${row.step}: ${row.file}`)) {
    throw new Error(`${row.verify} header does not cite step ${row.step}`);
  }
  const rollbackHeader = `-- Rollback for HOSTED-INSTALL step ${row.step}: ${row.file}`;
  if (!rollback.startsWith(rollbackHeader)) {
    throw new Error(`${row.rollback} header does not cite step ${row.step}`);
  }
  const applySql = strip(apply);
  if (!/\bBEGIN\s*;/.test(applySql) || !/\bCOMMIT\s*;/.test(applySql)) {
    throw new Error(`${row.file} is not wrapped in BEGIN and COMMIT`);
  }
  if (/\bGRANT\b/i.test(applySql)) throw new Error(`${row.file} grants a privilege`);
  const rollbackSql = strip(rollback);
  if (!/\bBEGIN\s*;/.test(rollbackSql) || !/\bCOMMIT\s*;/.test(rollbackSql)) {
    throw new Error(`${row.rollback} is not wrapped in BEGIN and COMMIT`);
  }
  if (/\bGRANT\b/i.test(rollbackSql)) throw new Error(`${row.rollback} grants a privilege`);
  assertSelectOnly(row.verify, verify);
  scanCitations(row.file, apply, byFile);
  scanCitations(row.verify, verify, byFile);
  scanCitations(row.rollback, rollback, byFile);
}

const preflight = read("proposed/m3/preflight.sql");
assertSelectOnly("proposed/m3/preflight.sql", preflight);
const preflightChecks = (preflight.match(/SELECT \d+ AS ord|SELECT \d+,/g) ?? []).length;
if (preflightChecks !== 17) throw new Error(`preflight has ${preflightChecks} checks`);

const tnc = strip(read("proposed/m3-packet/01-tnc-approval-expiry.sql"));
if (/security\s+definer/i.test(tnc)) throw new Error("the TNC file defines a security definer function");
if (/create\s+(or\s+replace\s+)?function/i.test(tnc)) throw new Error("the TNC file creates a function");

const rate = read("proposed/m3-packet/02-waitlist-coming-soon-rate.sql");
const rateSql = strip(rate);
if (!/SECURITY DEFINER/.test(rate) || !/SET search_path = ''/.test(rate)) {
  throw new Error("the rate function is missing SECURITY DEFINER or an empty search_path");
}
if (!/REVOKE ALL ON FUNCTION public\.waitlist_coming_soon_email_limit\(\) FROM PUBLIC, anon, authenticated, service_role/.test(rateSql)) {
  throw new Error("the rate function does not revoke execute from PUBLIC, anon, authenticated, and service_role");
}
if (/WAITLIST_CLAIM_SECRET/.test(rateSql) || /claim_token_hash/.test(rateSql)) {
  throw new Error("the rate function body mentions the claim secret or hash");
}

const rollbackRate = strip(read("proposed/m3-rollback/02-waitlist-coming-soon-rate.sql"));
if (/claim_token_hash|license_expiration|REVOKE\b/i.test(rollbackRate)) {
  throw new Error("the rate rollback touches grants or another feature's column");
}
const rollbackTnc = strip(read("proposed/m3-rollback/01-tnc-approval-expiry.sql"));
if (/license_expiration|insurance_expires_on/.test(rollbackTnc)) {
  throw new Error("the TNC rollback names an existing expiry column");
}

scanCitations("proposed/m3/HOSTED-INSTALL.md", hosted, byFile);
scanCitations("proposed/m3/preflight.sql", preflight, byFile);

let rejected = false;
try {
  scanCitations(
    "fixture",
    "HOSTED-INSTALL step 1 sits beside proposed/m3-packet/02-waitlist-coming-soon-rate.sql",
    byFile,
  );
} catch (error) {
  rejected = /step 1 next to proposed\/m3-packet\/02-waitlist-coming-soon-rate\.sql/.test(String(error));
}
if (!rejected) throw new Error("a step 1 citation beside the rate file was accepted");

const shaHeading = hosted.indexOf("SHA-256 of the current files:");
if (shaHeading < 0) throw new Error("SHA-256 table is missing");
const shaTable = hosted.slice(shaHeading);
const digests = [...shaTable.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)];
if (digests.length !== 7) throw new Error(`SHA-256 table has ${digests.length} rows`);
for (const [, file, digest] of digests) {
  const actual = createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex");
  if (actual !== digest) throw new Error(`${file} SHA-256 is ${actual}, table says ${digest}`);
}

console.log("m3 step citations match HOSTED-INSTALL");
