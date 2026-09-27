/**
 * No applicant-facing surface may state a trip threshold.
 *
 * 200 completed trips is an internal readiness signal, not a published
 * requirement — REAL RENTALS may be flexible on it, and an applicant should
 * never read that a specific number decides whether they qualify or how
 * quickly they get called. The submission gate that used to say so is gone;
 * this keeps it gone.
 *
 * Deliberately a copy test and not a readiness test: readiness.ts still bands
 * trip volume, still weights it, and must keep doing so. The rule is about
 * what we tell people, not what we measure.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let fail = 0;
const ok = (cond, label) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};

/** Everything an applicant or a member of the public can read. */
const PUBLIC_ROOTS = ["src/components/site", "src/components/portal", "src/routes"];
/** Staff-only, and legitimately full of trip counts and thresholds. */
const STAFF = /^src\/routes\/admin\.tsx$|^src\/components\/admin\//;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|mdx?)$/.test(name)) out.push(p);
  }
  return out;
}

const files = PUBLIC_ROOTS.flatMap(walk).filter((f) => !STAFF.test(f));

/**
 * Only the rendered words count. A `trips_completed` field name or a comment
 * explaining why the gate went away is not something an applicant reads, and a
 * test that flagged them would be noise nobody keeps passing.
 */
function visibleText(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\b[a-z_]+_[a-z_]+\b/g, " ");
}

const THRESHOLD = [
  [/\b\d{2,}\s*\+?\s*(completed\s+)?(trips|deliveries)\b/i, "a specific trip count"],
  [
    /\b(minimum|at least|must have|need|require[sd]?)\b[^.]{0,40}\b(trips|deliveries)\b/i,
    "a trip requirement",
  ],
  [
    /\b(trips|deliveries)\b[^.]{0,40}\b(required|minimum|threshold|to qualify)\b/i,
    "a trip threshold",
  ],
  [/\b(priorit|preferred)[a-z]*\b[^.]{0,40}\b(trips|deliveries)\b/i, "trip-based priority"],
  [/\b(trips|deliveries)\b[^.]{0,40}\b(priorit|preferred)/i, "trip-based priority"],
];

console.log("NO TRIP THRESHOLD ON ANY APPLICANT-FACING SURFACE");
const offenders = [];
for (const file of files) {
  const text = visibleText(readFileSync(file, "utf8"));
  for (const [re, what] of THRESHOLD) {
    const m = text.match(re);
    if (m) offenders.push(`${file}: ${what} — ${JSON.stringify(m[0].trim())}`);
  }
}
ok(offenders.length === 0, `${files.length} public files carry no trip threshold`);
for (const o of offenders) console.log(`       ${o}`);

console.log("\nTHE APPLICANT IS STILL ASKED FOR THEIR TRIP COUNT");
const wizard = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
ok(/How Many Trips Have You Completed/i.test(wizard), "the question is still there");
ok(/Leave blank if you're not sure/i.test(wizard), "  and answering is optional");
ok(!/canNext[^;]*trips/s.test(wizard), "  and no Next/Submit button depends on it");

console.log("\nTRIP VOLUME IS STILL AN INTERNAL READINESS FACTOR");
const readiness = readFileSync("src/lib/readiness.ts", "utf8");
ok(/key:\s*"trip_volume"/.test(readiness), "the factor still exists");
ok(
  /n >= 1000 \? 1 : n >= 500 \? 0\.8 : n >= 200 \? 0\.6 : n >= 50 \? 0\.3 : 0/.test(readiness),
  "  with its approved bands unchanged",
);

console.log("\nTHE AI SECOND OPINION CARRIES NO ELIGIBILITY CLIFF");
const scoring = readFileSync("src/lib/scoring.functions.ts", "utf8");
const rubric = scoring.slice(
  scoring.indexOf("const rubric ="),
  scoring.indexOf("`;", scoring.indexOf("const rubric =")),
);
ok(!/<\s*200\s*=\s*0/.test(rubric), "no '<200 = 0' cliff in the rubric");
ok(/not provided = 0/.test(rubric), "  a missing answer scores as absent");
ok(
  /Do NOT state or imply any eligibility threshold/.test(rubric),
  "  and the model is told not to write a threshold into its summary",
);
ok(/You are NOT deciding anything/.test(rubric), "  nor to decide anything");

console.log("\nEVERY WRITE TO ai_summary / ai_flags GOES THROUGH THE GUARD");
{
  // Source-level, because a runtime test cannot enumerate write paths. The
  // database backs this up: authenticated holds no UPDATE privilege on these
  // columns at all (20260927010000_ai_columns_service_role_only.sql).
  const writes = [];
  // The generated schema file declares these columns as types; it contains no
  // executable code and cannot write anything.
  const GENERATED = "src/integrations/supabase/types.ts";
  for (const file of walk("src").filter((f) => f !== GENERATED)) {
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      if (/^\s*ai_(summary|flags)\s*:/.test(line))
        writes.push({ file, line: i + 1, text: line.trim() });
    });
  }
  const outside = writes.filter((w) => w.file !== "src/lib/scoring.functions.ts");
  ok(
    outside.length === 0,
    `no ai_summary/ai_flags write outside scoring.functions.ts (found ${outside.length})`,
  );
  for (const w of outside) console.log(`       ${w.file}:${w.line} ${w.text}`);

  const scoring = readFileSync("src/lib/scoring.functions.ts", "utf8");
  ok(/sanitizeAssessment\(/.test(scoring), "the scorer calls the guard");
  // The only persisted write of a non-null summary must come from the guarded
  // result object, never from the raw parse.
  ok(!/ai_summary:\s*(rawSummary|parsed)/.test(scoring), "no raw model text is persisted");
  ok(!/ai_flags:\s*(rawFlags|parsed)/.test(scoring), "no raw model flags are persisted");
  ok(
    /ai_summary:\s*(result\.summary|null)/.test(scoring),
    "ai_summary is written from the guarded result, or nulled",
  );
  ok(
    /ai_flags:\s*(result\.flags|null|\[\])/.test(scoring),
    "ai_flags is written from the guarded result, or emptied",
  );
}

console.log("\nGUARD DIAGNOSTICS NEVER REACH THE DATABASE OR THE LOG VERBATIM");
{
  const scoring = readFileSync("src/lib/scoring.functions.ts", "utf8");
  ok(
    !/ai_removed|removed:\s*result\.removed/.test(scoring),
    "removals are not persisted on the row",
  );
  ok(/removals: result\.removed/.test(scoring), "  they are logged as structured diagnostics");
  const guard = readFileSync("src/lib/assessment-guard.ts", "utf8");
  // A Removal may carry field/reason/rule/index/length and nothing textual.
  const removalType = guard.slice(
    guard.indexOf("export type Removal"),
    guard.indexOf("export type SanitizedAssessment"),
  );
  ok(
    !/:\s*string(?!\s*\|)/.test(removalType.replace(/"[^"]*"/g, "")),
    "the Removal type carries no free-text field",
  );
}

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
