/**
 * Live install citations must use the HOSTED-INSTALL step numbers.
 * docs/m2-rehearsal.md is scanned, including the recommended install order
 * and the current-file SHA-256 table. Older narrative that still says
 * "step N" without "HOSTED-INSTALL" is historical and is not rewritten.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

function table(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\| (\d+) \| `([^`]+)` \|/);
    if (match) rows.push({ step: Number(match[1]), file: match[2] });
  }
  return rows;
}

const hosted = read("proposed/HOSTED-INSTALL.md");
const install = read("proposed/INSTALL.md");
const hostedRows = table(hosted);
const installRows = table(install.split("## Order")[1] ?? "");
if (hostedRows.length !== 29) throw new Error(`HOSTED-INSTALL table has ${hostedRows.length} rows`);
if (installRows.length !== hostedRows.length) throw new Error("INSTALL.md order length differs from HOSTED-INSTALL");
hostedRows.forEach((row, index) => {
  if (row.step !== index + 1) throw new Error(`HOSTED-INSTALL step ${row.step} is out of order`);
  if (installRows[index].step !== row.step || installRows[index].file !== row.file) {
    throw new Error(`INSTALL.md step ${installRows[index].step} is ${installRows[index].file}, table says ${row.file}`);
  }
});

const byFile = new Map(hostedRows.map((row) => [row.file, row.step]));
const extend = read("proposed/m2-packet/extend.sql");
if (!extend.startsWith("-- Step 27 of proposed/HOSTED-INSTALL.md")) {
  throw new Error("extend.sql does not cite HOSTED-INSTALL step 27");
}
const swap = read("proposed/vehicle-swap-v1.sql");
if (!swap.includes("HOSTED-INSTALL step 26") || swap.includes("step 25")) {
  throw new Error("vehicle-swap pointer does not cite step 26");
}
const preflight = read("proposed/m2-preflight.sql");
if (!preflight.includes("HOSTED-INSTALL step 5") || preflight.includes("step 4 grants")) {
  throw new Error("preflight still cites the CREATE grant as step 4");
}
if (hosted.includes("Step 11 already creates")) {
  throw new Error("HOSTED-INSTALL still says step 11 creates approval_scope");
}

const rehearsal = read("docs/m2-rehearsal.md");
const evidence = read("proposed/m2-packet/19b.sql");
const authRollback = read("proposed/rollback/01-auth-binding.sql");
const swapRollback = read("proposed/rollback/20-vehicle-swap.sql");
if (rehearsal.includes("010-auth-binding.sql") || authRollback.includes("010-auth-binding.sql")) {
  throw new Error("a citation still names 010-auth-binding.sql");
}
const recommended = rehearsal.split("## Recommended install order")[1]?.split("\n## ")[0] ?? "";
if (!recommended.includes("29-row table") || !recommended.includes("`proposed/HOSTED-INSTALL.md`")) {
  throw new Error("recommended install order does not point at the 29-row HOSTED-INSTALL table");
}
const contentShaAt = recommended.indexOf("record-uploaded-content-sha.sql");
const boundaryAt = recommended.indexOf("00-approval-boundary.sql");
if (contentShaAt < 0 || boundaryAt < 0 || contentShaAt > boundaryAt) {
  throw new Error("recommended install order places the approval boundary before content-sha");
}
if (!recommended.includes("HOSTED-INSTALL step 2 is `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql`")) {
  throw new Error("recommended install order does not cite content-sha as HOSTED-INSTALL step 2");
}
if (!recommended.includes("HOSTED-INSTALL step 3 is `proposed/m2-with-approval-boundary/00-approval-boundary.sql`")) {
  throw new Error("recommended install order does not cite the boundary as HOSTED-INSTALL step 3");
}
for (const file of [
  "06b-approval-identity-check.sql",
  "10b-approval-executor-writes.sql",
  "19c-agreement-contract.sql",
  "21-revoke-executor-create.sql",
]) {
  if (!recommended.includes(file)) throw new Error(`recommended install order omits ${file}`);
}
if (!authRollback.startsWith("-- Rollback for HOSTED-INSTALL step 1: proposed/m2-packet/01.sql")) {
  throw new Error("rollback 01 does not cite proposed/m2-packet/01.sql as HOSTED-INSTALL step 1");
}
if (!swapRollback.startsWith("-- Rollback for HOSTED-INSTALL step 26: proposed/m2-packet/20.sql")) {
  throw new Error("rollback 20 does not cite proposed/m2-packet/20.sql as HOSTED-INSTALL step 26");
}
const evidenceHeader = evidence.split("\n").slice(3, 12).join("\n");
for (const phrase of [
  "proposed/m2-packet/19.sql (HOSTED-INSTALL step 23)",
  "proposed/m2-packet/20.sql (HOSTED-INSTALL step 26)",
  "proposed/m2-packet/03.sql",
  "(HOSTED-INSTALL step 5)",
  "proposed/m2-packet/01.sql",
  "(HOSTED-INSTALL step 1)",
]) {
  if (!evidenceHeader.includes(phrase)) throw new Error(`19b.sql header is missing ${phrase}`);
}
if (evidenceHeader.includes("signed-archive-protection-v1.sql") || evidenceHeader.includes("packet step")) {
  throw new Error("19b.sql header still cites a packet-file step");
}

const scanned = [
  ["proposed/HOSTED-INSTALL.md", hosted],
  ["proposed/INSTALL.md", install],
  ["proposed/vehicle-swap-v1.sql", swap],
  ["proposed/m2-packet/extend.sql", extend],
  ["proposed/m2-preflight.sql", preflight],
  ["docs/m2-rehearsal.md", rehearsal],
  ["proposed/m2-packet/19b.sql", evidence],
  ["proposed/rollback/01-auth-binding.sql", authRollback],
  ["proposed/rollback/20-vehicle-swap.sql", swapRollback],
];
const stepAt = /HOSTED-INSTALL step (\d+)/g;
for (const [name, text] of scanned) {
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

if (byFile.get("proposed/m2-packet/10.sql") !== 13) throw new Error("10.sql is not step 13");
if (byFile.get("proposed/m2-packet/03.sql") !== 5) throw new Error("03.sql is not step 5");
if (byFile.get("proposed/m2-packet/11.sql") !== 15) throw new Error("11.sql is not step 15");
if (byFile.get("proposed/m2-packet/20.sql") !== 26) throw new Error("20.sql is not step 26");
if (byFile.get("proposed/m2-packet/extend.sql") !== 27) throw new Error("extend.sql is not step 27");
if (byFile.get("proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql") !== 2) {
  throw new Error("content-sha is not step 2");
}
if (byFile.get("proposed/m2-packet/21-revoke-executor-create.sql") !== 29) throw new Error("revoke is not step 29");
if (byFile.get("proposed/m2-packet/17.sql") !== 21) throw new Error("17.sql is not step 21");
if (byFile.get("proposed/m2-packet/18.sql") !== 22) throw new Error("18.sql is not step 22");
if (byFile.get("proposed/m2-packet/19.sql") !== 23) throw new Error("19.sql is not step 23");
if (byFile.get("proposed/m2-packet/19b.sql") !== 24) throw new Error("19b.sql is not step 24");
if (byFile.get("proposed/m2-with-approval-boundary/19c-agreement-contract.sql") !== 25) {
  throw new Error("19c is not step 25");
}
if (byFile.get("proposed/m2-packet/return.sql") !== 28) throw new Error("return.sql is not step 28");

function orderRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\| (\d+) \| `([^`]+)` \|/);
    if (!match) continue;
    const paths = [...line.matchAll(/`([^`]+\.sql)`/g)].map((item) => item[1]);
    rows.push({ step: Number(match[1]), file: match[2], rollback: paths[paths.length - 1] });
  }
  return rows;
}
const order = orderRows(hosted);
if (order.length !== 29) throw new Error(`HOSTED-INSTALL rollback column has ${order.length} rows`);
const listed = new Set(order.map((row) => row.rollback));
for (const row of order) {
  if (!row.rollback.startsWith("proposed/rollback/")) {
    throw new Error(`step ${row.step} rollback is ${row.rollback}`);
  }
  const header = read(row.rollback).split("\n")[0];
  const expected = `-- Rollback for HOSTED-INSTALL step ${row.step}: ${row.file}`;
  if (!header.startsWith(expected)) {
    throw new Error(`${row.rollback} header is ${JSON.stringify(header)}, expected ${expected}`);
  }
}
const rollbackFiles = readdirSync(resolve(root, "proposed/rollback")).filter((name) => name.endsWith(".sql")).sort();
if (rollbackFiles.length !== 31) throw new Error(`rollback directory has ${rollbackFiles.length} sql files`);
for (const name of rollbackFiles) {
  const file = `proposed/rollback/${name}`;
  const lines = read(file).split("\n");
  const header = lines[0];
  if (header.includes("M2 rehearsal step")) throw new Error(`${file} still uses a rehearsal step number`);
  if (listed.has(file)) continue;
  if (name === "backfill-content-sha.sql") {
    const body = lines.join("\n");
    if (body.includes("HOSTED-INSTALL") || /\bstep \d+\b/.test(body)) {
      throw new Error("backfill undo cites an install step");
    }
    continue;
  }
  if (name !== "00-approval-data-export.sql") throw new Error(`${file} is not in the HOSTED-INSTALL rollback column`);
  const exportLine = lines[3] ?? "";
  if (!exportLine.includes("HOSTED-INSTALL step 3: proposed/m2-with-approval-boundary/00-approval-boundary.sql")) {
    throw new Error("00-approval-data-export.sql line 4 does not cite HOSTED-INSTALL step 3");
  }
  if (exportLine.includes("120-storage") || /\bstep 17\b/.test(exportLine)) {
    throw new Error("00-approval-data-export.sql still cites the storage-integrity rollback");
  }
}

const shaHeading = rehearsal.indexOf("SHA-256 of the current files:");
if (shaHeading < 0) throw new Error("rehearsal SHA-256 table is missing");
const shaTable = rehearsal.slice(shaHeading, rehearsal.indexOf("\n### ", shaHeading));
const digests = [...shaTable.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)];
if (digests.length !== 13) throw new Error(`SHA-256 table has ${digests.length} rows`);
for (const [, file, digest] of digests) {
  const actual = createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex");
  if (actual !== digest) throw new Error(`${file} SHA-256 is ${actual}, table says ${digest}`);
}

console.log("step citations match HOSTED-INSTALL");
