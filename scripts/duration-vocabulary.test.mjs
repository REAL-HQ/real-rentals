/**
 * Expected duration moved to a month scale. Two things have to stay true at
 * once: new applications record the new values, and the eighteen
 * applications answered with the old ones keep reading correctly — including
 * being saveable again if somebody resumes a half-finished draft.
 *
 * Also asserts the thing the business cares about: the answer is an estimate,
 * never a contractual date and never a qualification rule.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const src = readFileSync("src/lib/applications.functions.ts", "utf8");

console.log("BOTH VOCABULARIES VALIDATE");
{
  // Lift the real enum out of the schema rather than restating it.
  const m = src.match(/expected_duration: z\s*\n?\s*\.enum\(\[([\s\S]*?)\]\)/);
  ok(Boolean(m), "the validator declares an explicit enum");
  const values = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const schema = z.enum(values).nullable().optional();

  for (const v of ["1_month", "2_months", "3_months", "4plus_months", "not_sure"]) {
    ok(schema.safeParse(v).success, `new value accepted: ${v}`);
  }
  for (const v of ["1-2_weeks", "3-4_weeks", "1-2_months", "2plus_months", "ongoing"]) {
    ok(schema.safeParse(v).success, `historical value still accepted (an old draft can be saved): ${v}`);
  }
  ok(!schema.safeParse("6_years").success, "an invented value is refused");
  ok(schema.safeParse(null).success, "and null is fine — the question is optional");
}

console.log("\nTHE DAY COUNT IS A MIDPOINT, AND 'NOT SURE' HAS NONE");
{
  const block = src.slice(src.indexOf("const DURATION_LABELS"), src.indexOf("const band = fields.expected_duration") + 400);
  const entries = [...block.matchAll(/["']?([a-z0-9_+-]+)["']?:\s*\{ label: "([^"]+)", days: (null|\d+) \}/g)]
    .map((m) => ({ key: m[1], label: m[2], days: m[3] === "null" ? null : Number(m[3]) }));
  const by = Object.fromEntries(entries.map((e) => [e.key, e]));

  ok(entries.length === 10, `all ten values carry a label (${entries.length})`);
  ok(by["not_sure"]?.days === null, "not_sure records no day count");
  ok(by["1_month"]?.days === 30 && by["4plus_months"]?.days === 120,
     "the month bands carry their midpoints (30 … 120)");
  ok(/if \(band\.days !== null\) patch\.rental_duration_days = band\.days;/.test(block),
     "and a null day count is not written at all, rather than written as 0");
  for (const k of ["1-2_weeks", "3-4_weeks", "1-2_months", "2plus_months", "ongoing"]) {
    ok(Boolean(by[k]), `historical band still resolves a label: ${k} -> ${by[k]?.label}`);
  }
}

console.log("\nDURATION NEVER BECOMES A CONTRACTUAL DATE");
{
  const ag = readFileSync("src/lib/agreements.functions.ts", "utf8");
  ok(!/expected_duration/.test(ag), "the agreement module never reads expected_duration");
  ok(!/rental_duration_days/.test(ag), "  nor the derived day count");
  ok(!/app\.pickup_date|app\.return_date/.test(ag), "  nor the application's intent dates");
}

console.log("\nSTAFF DISPLAY READS BOTH");
{
  const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  const map = panel.slice(panel.indexOf("const DURATION_LABEL"), panel.indexOf("const DURATION_LABEL") + 900);
  for (const k of ["1_month", "2_months", "3_months", "4plus_months", "not_sure",
                   "1-2_weeks", "3-4_weeks", "1-2_months", "2plus_months", "ongoing"]) {
    ok(new RegExp(`["']?${k.replace(/[+]/g, "\\\\+")}["']?:`).test(map), `staff label for ${k}`);
  }
  ok(/DURATION_LABEL\[[^\]]+\] \?\?/.test(panel),
     "an unrecognised value falls back to the raw string rather than rendering blank");
}

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
