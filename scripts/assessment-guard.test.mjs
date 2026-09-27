/**
 * The AI second opinion must not be able to put an eligibility threshold or a
 * verdict into the application record, whatever the model decides to write.
 *
 * These are adversarial: every input below is something a model plausibly
 * produces under the current rubric, and none of it may survive.
 */
import { sanitizeAssessment } from "../.readiness-build/assessment-guard.js";

let fail = 0;
const ok = (cond, label) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};
const run = (summary, flags = []) => sanitizeAssessment({ summary, flags });

console.log("A TRIP THRESHOLD CANNOT REACH THE RECORD");
for (const line of [
  "Strong rating but below our 200-trip minimum.",
  "Applicant has 150 trips, short of the 200 trip requirement.",
  "Does not meet the minimum trip count for priority review.",
  "Insufficient trip history to qualify.",
  "Fewer than 200 deliveries, so not eligible yet.",
  "Trip count is under the threshold we look for.",
  "At least 200 trips are required and this driver has 40.",
]) {
  const r = run(line);
  ok(!r.summary.includes("200") && r.removed.length > 0, `removed: ${JSON.stringify(line)}`);
}

console.log("\nA VERDICT CANNOT REACH THE RECORD");
for (const line of [
  "Recommend declining this applicant.",
  "Should be approved immediately.",
  "I would reject this application.",
  "Do not approve — too risky.",
  "This driver is disqualified.",
]) {
  const r = run(line);
  ok(
    r.removed.some((x) => x.includes("verdict")),
    `removed as a verdict: ${JSON.stringify(line)}`,
  );
}

console.log("\nFLAGS ARE FILTERED TOO, SLUGS AND ALL");
const f = run("Solid applicant.", [
  "below_200_trips",
  "insufficient_trips",
  "trips-below-minimum",
  "recommend_decline",
  "does_not_meet_minimum",
  "screenshot_mismatch",
  "rating_unverified",
]);
ok(!f.flags.some((x) => /trip/i.test(x)), "no trip-threshold flag survives");
ok(!f.flags.includes("recommend_decline"), "no verdict flag survives");
ok(f.flags.includes("screenshot_mismatch"), "a legitimate evidence flag is kept");
ok(f.flags.includes("rating_unverified"), "  and so is an unverified-claim flag");
ok(f.summary === "Solid applicant.", "  while a clean summary is untouched");

console.log("\nHONEST DESCRIPTION IS NOT TOUCHED");
for (const line of [
  "1,200 trips completed with a 4.95 rating across three platforms.",
  "Only 40 trips completed, and no screenshots were supplied.",
  "Licence uploaded and readable; insurance card matches the claimed carrier.",
  "Trip count not provided, so experience is unknown.",
  "Claimed 800 trips but the screenshot shows 300 — major discrepancy.",
  // Exceeding a number is praise, not a bar. The two are not symmetrical.
  "Active on three platforms, over 2,000 deliveries.",
  "Rating below 4.5 with 900 trips completed.",
  "Insurance expires in under 30 days; 1,500 trips on file.",
]) {
  const r = run(line);
  ok(r.summary === line && r.removed.length === 0, `kept: ${JSON.stringify(line)}`);
}

console.log("\nFILTERING IS VISIBLE, NEVER SILENT OR INVENTED");
const mixed = run(
  "Experienced driver with 900 trips and a 4.9 rating. Below our 200-trip minimum for the premium tier.",
);
ok(
  mixed.summary === "Experienced driver with 900 trips and a 4.9 rating.",
  "the clean sentence survives and the offending one does not",
);
ok(mixed.removed.length === 1, "  and the removal is reported");

const wiped = run("Recommend declining. Below the minimum trip count.");
ok(
  wiped.summary.startsWith("Assessment withheld:"),
  "a fully filtered summary says so rather than going blank",
);
ok(!/\d/.test(wiped.summary), "  and invents no assessment of its own");

const clean = run("", []);
ok(clean.summary === "" && clean.removed.length === 0, "an empty assessment stays empty");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
