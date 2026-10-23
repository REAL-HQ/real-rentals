// The 1-25 Record Rental sequence has no verification query of its own.
//
// Step 29 revokes CREATE from rr_record_executor, and its verify query asserts
// `count(*)=76` functions. Steps 26, 27 and 28 contribute five of those, so
// after a 1-25 install the same query returns `f` on a correct install -- which
// the runbook reads as "stop and roll back".
//
// This composes the missing query instead of editing either approved one:
//   - every line of the STEP 25 query, verbatim (it asserts count(*)=71)
//   - plus the two CREATE negations lifted verbatim from the STEP 29 query
//
// Nothing is retyped and no new SQL logic is introduced. Run with --check to
// verify the committed file still matches both approved queries; run with no
// argument to print it.
//
//   node scripts/m2-step29-after-step25.mjs            # print
//   node scripts/m2-step29-after-step25.mjs --check    # verify the committed file
import { readFileSync } from "node:fs";

const RUNBOOK = "proposed/HOSTED-INSTALL.md";
const OUTPUT = "proposed/m2-verify/step29-after-step25.sql";

/** The one fenced sql block under `### Step <n>`. */
export function stepQuery(runbook, step) {
  const head = new RegExp(`^### Step ${step}$`, "m");
  const at = runbook.search(head);
  if (at < 0) throw new Error(`no "### Step ${step}" heading`);
  const rest = runbook.slice(at);
  const open = rest.indexOf("```sql\n");
  if (open < 0) throw new Error(`step ${step} has no sql block`);
  const body = rest.slice(open + "```sql\n".length);
  const close = body.indexOf("\n```");
  if (close < 0) throw new Error(`step ${step} sql block is not closed`);
  const next = rest.indexOf("\n### Step ");
  if (next >= 0 && open > next) throw new Error(`step ${step} sql block belongs to a later step`);
  return body.slice(0, close);
}

/** The CREATE negations step 29 asserts, in the order it asserts them. */
export function createNegations(step29) {
  const lines = step29
    .split("\n")
    .filter((l) => /has_schema_privilege\('rr_record_executor','(public|private)','CREATE'\)/.test(l));
  if (lines.length !== 2) throw new Error(`step 29 has ${lines.length} rr_record_executor CREATE assertions, expected 2`);
  for (const l of lines) {
    if (!/^\s*AND NOT has_schema_privilege/.test(l)) throw new Error(`not a plain AND NOT conjunct: ${l}`);
  }
  return lines;
}

export function compose(runbook) {
  const step25 = stepQuery(runbook, 25);
  const negations = createNegations(stepQuery(runbook, 29));
  // Step 25's query opens with its own distinguishing assertion, then a run of
  // `AND NOT has_schema_privilege(...)` conjuncts. Splice the two CREATE
  // conjuncts in at the front of that run, so every original line is kept and
  // the whole thing stays one conjunction.
  const lines = step25.split("\n");
  const firstConjunct = lines.findIndex((l) => /^\s*AND NOT has_schema_privilege/.test(l));
  if (firstConjunct < 1) throw new Error("step 25 query has no AND NOT has_schema_privilege conjunct");
  const composed = [...lines.slice(0, firstConjunct), ...negations, ...lines.slice(firstConjunct)];
  return `${header()}${composed.join("\n")}\n`;
}

function header() {
  return [
    "-- Verification for a Record Rental install that runs HOSTED-INSTALL steps 1-25",
    "-- and then step 29, leaving steps 26 (vehicle swap), 27 (extend) and 28",
    "-- (return checklist) out.",
    "--",
    "-- Step 29's own verify query asserts count(*)=76 functions. Steps 26-28",
    "-- contribute five of those, so it returns f after a 1-25 install even when",
    "-- that install is correct. This query is the step 25 query verbatim, which",
    "-- asserts count(*)=71, plus the two CREATE negations copied verbatim from the",
    "-- step 29 query. It introduces no new SQL logic.",
    "--",
    "-- GENERATED from proposed/HOSTED-INSTALL.md by",
    "-- scripts/m2-step29-after-step25.mjs. Do not hand-edit: run the generator.",
    "-- scripts/m2-step29-after-step25.test.mjs fails if this file and the two",
    "-- approved queries ever disagree.",
    "--",
    "-- Run read-only, in its own execution, after step 29. It must return t.",
    "",
  ].join("\n");
}

// Importing this module must not run the CLI: the test imports stepQuery and
// createNegations from here.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith("m2-step29-after-step25.mjs");
if (invokedDirectly) await main();

async function main() {
const runbook = readFileSync(RUNBOOK, "utf8");
const sql = compose(runbook);
if (process.argv.includes("--check")) {
  const committed = readFileSync(OUTPUT, "utf8");
  if (committed !== sql) {
    console.error(`${OUTPUT} does not match the approved step 25 and step 29 queries. Re-run the generator.`);
    process.exit(1);
  }
  console.log(`${OUTPUT} matches the approved step 25 and step 29 queries`);
} else if (process.argv.includes("--write")) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("proposed/m2-verify", { recursive: true });
  writeFileSync(OUTPUT, sql);
  console.log(`wrote ${OUTPUT}`);
} else {
  process.stdout.write(sql);
}
}
