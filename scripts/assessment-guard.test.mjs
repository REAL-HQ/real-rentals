/**
 * Adversarial tests against the real guard.
 *
 * Every string below is run through sanitizeAssessment itself — nothing here
 * is asserted by reading the source. The blocked and surviving corpora are the
 * ones specified in review; the rest covers each field independently, mixed
 * content, the fallback, and what the diagnostics are allowed to carry.
 */
import { sanitizeAssessment } from "../.readiness-build/assessment-guard.js";

let fail = 0;
const ok = (cond, label) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "PASS" : "BLOCKER"}  ${label}`);
};

/** A prohibited string must be blocked in the summary AND as a flag. */
const MUST_BLOCK = [
  "below_200_trips",
  "below 200 trips",
  "fewer than 200 trips",
  "does not meet the 200-trip minimum",
  "below our 200-trip minimum",
  "minimum of 200 trips",
  "requires 200+ trips",
  "not enough trips to qualify",
  "should be rejected because of trip count",
  "applicant does not qualify",
  "decline this applicant",
];

/** Honest description. None of it may be touched, in either field. */
const MUST_SURVIVE = [
  "40 trips completed",
  "only 40 trips completed",
  "150 completed trips",
  "over 2,000 deliveries",
  "applicant reports 800 trips",
  "screenshot appears to show 300 trips",
  "applicant reported 800 trips but screenshot appears to show 300",
  "rating below 4.5 with 900 trips",
  "trip count could not be verified",
];

console.log("MUST BE BLOCKED — ai_summary");
for (const text of MUST_BLOCK) {
  const r = sanitizeAssessment({ summary: text, flags: [] });
  ok(r.removed.length > 0 && !r.summary.includes(text), `summary blocked: ${JSON.stringify(text)}`);
}

console.log("\nMUST BE BLOCKED — each ai_flags entry, independently");
for (const text of MUST_BLOCK) {
  const asFlag = text.replace(/\s+/g, "_");
  const r = sanitizeAssessment({ summary: "", flags: [asFlag] });
  ok(r.flags.length === 0 && r.removed.length === 1, `flag blocked: ${JSON.stringify(asFlag)}`);
}

console.log("\nMUST SURVIVE — ai_summary");
for (const text of MUST_SURVIVE) {
  const r = sanitizeAssessment({ summary: text, flags: [] });
  ok(r.summary === text && r.removed.length === 0, `summary kept: ${JSON.stringify(text)}`);
}

console.log("\nMUST SURVIVE — each ai_flags entry, independently");
for (const text of MUST_SURVIVE) {
  const asFlag = text.replace(/\s+/g, "_");
  const r = sanitizeAssessment({ summary: "", flags: [asFlag] });
  ok(r.flags.length === 1 && r.removed.length === 0, `flag kept: ${JSON.stringify(asFlag)}`);
}

console.log("\nMIXED CONTENT");
const mixed = sanitizeAssessment({
  summary:
    "Applicant reports 800 trips across three platforms. Below our 200-trip minimum for priority. Licence photo is legible and current.",
  flags: [],
});
ok(
  mixed.summary ===
    "Applicant reports 800 trips across three platforms. Licence photo is legible and current.",
  "one prohibited sentence removed, the two legitimate ones preserved in order",
);
ok(mixed.removed.length === 1, "  exactly one removal reported");

const oneFlag = sanitizeAssessment({
  summary: "Solid applicant.",
  flags: ["screenshot_mismatch", "below_200_trips", "rating_unverified"],
});
ok(
  JSON.stringify(oneFlag.flags) === JSON.stringify(["screenshot_mismatch", "rating_unverified"]),
  "only the prohibited flag is removed, the others keep their order",
);
ok(oneFlag.summary === "Solid applicant.", "  and a clean summary is untouched by flag filtering");

const wiped = sanitizeAssessment({
  summary: "Decline this applicant. Fewer than 200 trips.",
  flags: [],
});
ok(
  /^Assessment withheld:/.test(wiped.summary),
  "an entirely prohibited summary returns the fallback",
);
ok(!/200|decline/i.test(wiped.summary), "  which repeats none of the prohibited text");
ok(wiped.removed.length === 2, "  and reports both removals");

const allFlags = sanitizeAssessment({
  summary: "Clean.",
  flags: ["below_200_trips", "recommend_decline"],
});
ok(
  Array.isArray(allFlags.flags) && allFlags.flags.length === 0,
  "an empty flags array is a valid result",
);
ok(allFlags.summary === "Clean.", "  and does not disturb the summary");

console.log("\nDIAGNOSTICS CARRY NO PROHIBITED TEXT AND NO APPLICANT DATA");
const sensitive = sanitizeAssessment({
  summary:
    "Karen Pantoja, DOB 1988-04-02, licence D123-456-78-900-0, policy GEICO-99887766. Below our 200-trip minimum.",
  flags: ["below_200_trips"],
});
const asJson = JSON.stringify(sensitive.removed);
ok(!/200-trip|Below our/i.test(asJson), "the raw prohibited sentence is not in the diagnostics");
ok(!/Karen|Pantoja/i.test(asJson), "  no applicant name");
ok(!/1988-04-02/.test(asJson), "  no date of birth");
ok(!/D123-456/.test(asJson), "  no licence number");
ok(!/GEICO-99887766/.test(asJson), "  no policy number");
ok(!/below_200_trips/.test(asJson), "  not even the prohibited flag's own text");
ok(
  sensitive.removed.every((r) => r.field && r.reason && r.rule),
  "  but every removal still names the field, the reason and the rule that fired",
);
ok(
  sensitive.removed.some((r) => typeof r.length === "number" && r.length > 0),
  "  and carries the shape of what was dropped, for correlation",
);
// The guard filters thresholds and verdicts, not personal data: the first
// sentence is legitimate description and is kept as written. What matters is
// that none of it reaches the log, which the assertions above cover.
ok(
  /Karen Pantoja/.test(sensitive.summary),
  "a legitimate descriptive sentence is still kept intact",
);

console.log("\nEDGE CASES");
const empty = sanitizeAssessment({ summary: "", flags: [] });
ok(
  empty.summary === "" && empty.flags.length === 0 && empty.removed.length === 0,
  "an empty assessment stays empty and reports nothing",
);
const spaced = sanitizeAssessment({ summary: "   ", flags: [] });
ok(spaced.summary === "" && spaced.removed.length === 0, "whitespace-only is treated as empty");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
