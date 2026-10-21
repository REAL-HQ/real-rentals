/**
 * Live install citations must use the HOSTED-INSTALL step numbers.
 * Historical rehearsal notes are not scanned.
 */
import { readFileSync } from "node:fs";
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

const scanned = [
  ["proposed/HOSTED-INSTALL.md", hosted],
  ["proposed/INSTALL.md", install],
  ["proposed/vehicle-swap-v1.sql", swap],
  ["proposed/m2-packet/extend.sql", extend],
  ["proposed/m2-preflight.sql", preflight],
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

console.log("step citations match HOSTED-INSTALL");
