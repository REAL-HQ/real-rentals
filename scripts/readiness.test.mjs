// Readiness model tests.
//
//   npm run test:readiness
//
// Plain Node, no test framework: the module is pure, so the whole suite is
// assertions over return values. It typechecks and transpiles src/lib first,
// then imports the real output — an earlier version stripped types with a
// regex and silently mangled a ternary, which is exactly the kind of bug a
// test suite is supposed to catch rather than contain.

import {
  computeReadiness, FACTORS, TOTAL_WEIGHT, setClockForTests,
  THRESHOLDS, HOT_PROSPECT, isHotProspect, compareReadiness, REMEDY_LABEL,
} from "../.readiness-build/readiness.js";
import { readFileSync } from "node:fs";
import { buildReadinessIndex } from "../.readiness-build/readiness-index.js";

let fail = 0;
const ok = (c, m) => { console.log(`${c ? "  ok " : "FAIL "} ${m}`); if (!c) fail++; };
const eq = (a, b, m) => ok(a === b, `${m}${a === b ? "" : `  (got ${a}, want ${b})`}`);

console.log(`model: ${FACTORS.length} factors, total weight ${TOTAL_WEIGHT}`);
eq(TOTAL_WEIGHT, 100, "weights total 100");
ok(new Set(FACTORS.map(f => f.key)).size === FACTORS.length, "factor keys are unique");

console.log("\nNULL IS NEVER A NEGATIVE FACT");
const blank = computeReadiness({}, {});
eq(blank.attention.length, 0, "an empty application raises zero concerns");
eq(blank.unknowns.length, FACTORS.length, "every factor reads as unknown");
eq(blank.coverage, 0, "coverage 0");
eq(blank.qualification, null, "qualification is null, not 0 — 0/0 is not zero");
eq("composite" in blank, false, "there is no composite 0-100 readiness number");
eq(blank.state, "more_info_needed", "state is More Info Needed, not Needs Attention");

console.log("\nNULL IS NEVER A POSITIVE FACT EITHER (the old screening bug)");
const f = (r, k) => r.factors.find(x => x.key === k);
eq(f(blank, "accidents").state, "unknown", "NULL accidents is unknown, not a clean record");
eq(f(blank, "accidents").earned, 0, "  and earns nothing");
eq(f(blank, "points").state, "unknown", "NULL licence points is unknown, not zero points");
eq(f(blank, "points").earned, 0, "  and earns nothing");
eq(f(computeReadiness({}, { accidents_last_3yr: 0 }), "accidents").state, "positive", "a checked 0 IS a clean record");

console.log("\nMISSING vs BAD, per the brief");
eq(f(blank, "driver_rating").state, "unknown", "missing rating != poor rating");
eq(f(computeReadiness({ rating: 3.9 }, {}), "driver_rating").state, "attention", "  a low rating IS a concern");
eq(f(blank, "insurance_cover").state, "unknown", "missing insurance != failed insurance");
eq(f(computeReadiness({}, { has_personal_insurance: false }), "insurance_cover").state, "attention", "  no insurance IS a concern");
eq(f(blank, "trip_volume").state, "unknown", "missing trip count != zero trips");
eq(f(computeReadiness({ trips_completed: 10 }, {}), "trip_volume").state, "attention", "  10 trips IS a concern");

console.log("\nQUALIFICATION EXCLUDES UNKNOWNS FROM THE DENOMINATOR");
const thin = computeReadiness({ license_valid: true, start_timing: "Today" }, {});
eq(thin.qualification, 100, "two good answers out of two known = 100 qualification");
ok(thin.coverage < 20, `  but coverage is only ${thin.coverage}%`);
eq(thin.state, "more_info_needed", "  and the state refuses to call it ready");

console.log("\nEVIDENCE QUALITY");
const selfRep = computeReadiness({ license_valid: true }, {});
const staffVer = computeReadiness({}, { license_active: true });
eq(f(selfRep, "license_valid").evidence, "self_reported", "wizard answer is self-reported");
eq(f(staffVer, "license_valid").evidence, "staff_verified", "screening answer is staff-verified");
eq(selfRep.verifiedCoverage, 0, "  self-reported adds nothing to verified coverage");
ok(staffVer.verifiedCoverage > 0, "  staff-verified does");
eq(f(computeReadiness({ license_photo_url: "x.jpg" }, {}), "license_doc").evidence, "document", "a file is document evidence");
eq(f(computeReadiness({}, { license_active: true }), "license_valid").earned, f(computeReadiness({ license_valid: true }, {}), "license_valid").earned,
   "evidence quality does not change how good they look, only how sure we are");

console.log("\nSTAFF FACTS OVERRIDE SELF-REPORTED ONES");
const conflict = computeReadiness({ license_valid: true }, { license_active: false });
eq(f(conflict, "license_valid").state, "attention", "staff 'not active' beats self-reported 'valid'");
ok(conflict.disqualifiers.includes("Licence not active"), "  and raises a disqualifier");

console.log("\nDISQUALIFIERS ARE SURFACED, NOT AVERAGED AWAY");
const dui = computeReadiness({ license_valid: true }, { has_dui: true, gig_account_status: "active" });
ok(dui.disqualifiers.includes("DUI on record"), "DUI is listed");
eq(dui.state, "needs_attention", "  and forces Needs Attention whatever the score");

console.log("\nNO OUTCOME LEAKAGE");
const text = readFileSync(new URL("../src/lib/readiness.ts", import.meta.url), "utf8");
ok(!/\bstatus\b\s*===\s*["']active["']/.test(text), "model never reads application status");
// Strip both comment styles before looking for outcome references. Prose
// about what the model must not do is not the model doing it.
const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
// "deactivated" is the gig platform dropping them — an input about the
// applicant, not an outcome of our own decision. Match our outcomes only.
ok(!/\bapproved\b|\brental\b|\breviewed_at\b|\bdeposit_paid\b/i.test(code),
   "model never reads our own approval / rental / review outcomes");
ok(!/a\.status|app\.status|\.status\s*===\s*["'](active|approved|new|partial)["']/.test(code),
   "model never branches on application lifecycle status");

console.log("\nA TARGET DATE THAT HAS PASSED IS NOT URGENCY");
setClockForTests(() => Date.parse("2026-09-26T00:00:00Z"));
const timing = (app, scr) => computeReadiness(app, scr).factors.find((f) => f.key === "timing");
const soon = timing({}, { needed_by_date: "2026-10-01" });
eq(soon.state, "positive", "a date inside 14 days is urgency");
eq(soon.detail, "Needs a vehicle within 5 days", "  and says how soon");
const far = timing({}, { needed_by_date: "2027-01-01" });
eq(far.state, "positive", "a date beyond 14 days still counts, partially");
eq(far.earned < far.weight, true, "  at less than full weight");
const stale = timing({}, { needed_by_date: "2026-07-27" });
eq(stale.state, "unknown", "a date two months gone is stale, not urgent");
const staleWithTiming = timing({ start_timing: "This week" }, { needed_by_date: "2026-07-27" });
eq(staleWithTiming.state, "positive", "  a stale date falls through to stated timing");
eq(staleWithTiming.evidence, "self_reported", "  and drops back to self-reported evidence");
setClockForTests(() => Date.now());

console.log("\nFOUR STATES, NO FIFTH, AND NO 'APPROVED'");
const states = new Set();
const mk = (o, sc) => { const r = computeReadiness(o, sc ?? {}); states.add(r.state); return r; };
const strong = { license_valid: true, license_photo_url: "l.jpg", full_coverage_insurance: true,
  insurance_doc_url: "i.jpg", insurance_rideshare_endorsement: true, platforms: ["Uber","Lyft"],
  trips_completed: 2000, rating: 4.9, start_timing: "Today" };
const fullScreen = { gig_account_status: "active", months_on_platform: 24, license_active: true,
  license_years: 8, has_personal_insurance: true, policy_active: true, accidents_last_3yr: 0,
  license_points: 0, has_dui: false, major_violations: false, drive_type: "full_time",
  card_in_own_name: true, rate_confirmed: true, insurance_name_matches_license: true };
const ready = mk(strong, fullScreen);
eq(ready.state, "decision_ready", "fully known and good is Decision Ready");
ok(ready.coverage >= THRESHOLDS.READY_COVERAGE, "  with coverage at or above the ready floor");
const promising = mk({ license_valid: true, trips_completed: 900, rating: 4.9, start_timing: "Today" },
                     { gig_account_status: "active" });
eq(promising.state, "promising_more_info", "good but thin is Promising - More Info Needed");
states.add(thin.state);
eq(thin.state, "more_info_needed", "two good answers alone is More Info Needed, never ready");
eq(thin.qualification, 100, "  even though qualification is 100");
ok(thin.coverage < THRESHOLDS.PROMISING_COVERAGE, "  because coverage is below the promising floor");
const flagged = mk({ license_valid: true }, { has_dui: true });
eq(flagged.state, "needs_attention", "a critical concern is Needs Attention at any coverage");
const softFlag = mk({ ...strong, start_timing: "Just checking options" }, fullScreen);
ok(softFlag.attention.length > 0, "'just checking options' is listed as an attention factor");
eq(softFlag.state !== "needs_attention", true, "  but does not drag the state to Needs Attention");
eq([...states].every((x) => x !== "approved"), true, "no state is ever 'approved'");

console.log("\nEVERY GAP NAMES THE ACTION THAT CLOSES IT");
ok(FACTORS.every((x) => REMEDY_LABEL[x.remedy]), "every factor has a known remedy");
ok(thin.unknowns.every((u) => REMEDY_LABEL[u.remedy]), "every Still Needed item has an action");
eq(f(thin, "accidents").remedy, "interview", "accident history is closed by the interview");
eq(f(thin, "license_doc").remedy, "request_document", "the licence image is closed by a request");

console.log("\nORDERING WITHOUT A SCORE");
const ordered = [thin, ready, promising, flagged].sort(compareReadiness).map((r) => r.state);
eq(ordered.join(" > "), "needs_attention > decision_ready > promising_more_info > more_info_needed",
   "concerns first, then ready, then promising, then thin");

console.log("\nHOT PROSPECT IS A FOLLOW-UP FLAG, NOT AN APPROVAL");
eq(isHotProspect(thin), false, "100 qualification on 14% coverage is NOT hot");
eq(isHotProspect(flagged), false, "a critical concern is never hot");
eq(isHotProspect(ready), true, "known, strong and unflagged is hot");
ok(HOT_PROSPECT.MIN_COVERAGE >= 40, "the rule has a real coverage floor");

console.log("\nCRITICAL CONCERNS (item 17)");
const critical = (scr) => computeReadiness({ license_valid: true }, scr);
ok(critical({ has_dui: true }).disqualifiers.includes("DUI on record"),
   "known DUI is a critical concern");
eq(critical({ has_dui: true }).state, "needs_attention", "  and forces Needs Attention");
ok(critical({ license_active: false }).disqualifiers.includes("Licence not active"),
   "inactive licence is a critical concern");
eq(critical({ license_active: false }).state, "needs_attention", "  and forces Needs Attention");
ok(critical({ driver_age: 19 }).disqualifiers.includes("Driver under 21"),
   "under 21 is a critical concern");
ok(critical({ gig_account_status: "deactivated" }).disqualifiers.length > 0,
   "a deactivated gig account is a critical concern");
ok(critical({ card_in_own_name: false }).disqualifiers.length > 0,
   "a card in somebody else's name is a critical concern");
eq(critical({ has_dui: false }).disqualifiers.length, 0, "an answered 'no DUI' is not a concern");
eq(critical({}).disqualifiers.length, 0, "an unasked DUI question is not a concern either");

console.log("\nA CRITICAL CONCERN OVERRIDES QUALIFICATION");
const perfect = computeReadiness(strong, fullScreen);
const perfectButDui = computeReadiness(strong, { ...fullScreen, has_dui: true });
eq(perfect.state, "decision_ready", "the same applicant without the DUI is Decision Ready");
ok(perfectButDui.qualification >= THRESHOLDS.READY_QUALIFICATION,
   "with the DUI, qualification is still high");
ok(perfectButDui.coverage >= THRESHOLDS.READY_COVERAGE, "  and coverage is still high");
eq(perfectButDui.state, "needs_attention", "  and the state is Needs Attention regardless");
eq(isHotProspect(perfectButDui), false, "  and they are not a Hot Prospect");

console.log("\nCOVERAGE GOVERNS THE CEILING (item 17)");
const highQualLowCov = computeReadiness({ license_valid: true, start_timing: "Today" }, {});
eq(highQualLowCov.qualification, 100, "high qualification");
ok(highQualLowCov.coverage < THRESHOLDS.PROMISING_COVERAGE, "  on very low coverage");
ok(highQualLowCov.state !== "decision_ready", "  is never Decision Ready");
eq(highQualLowCov.state, "more_info_needed", "  it is More Info Needed");
const highQualMidCov = computeReadiness(
  { license_valid: true, trips_completed: 900, rating: 4.9, start_timing: "Today" },
  { gig_account_status: "active" },
);
ok(highQualMidCov.coverage >= THRESHOLDS.PROMISING_COVERAGE, "mid coverage");
ok(highQualMidCov.coverage < THRESHOLDS.READY_COVERAGE, "  but below the ready floor");
eq(highQualMidCov.state, "promising_more_info", "  is Promising, not Decision Ready");
eq(perfect.state, "decision_ready", "high qualification with real coverage IS Decision Ready");

console.log("\nWEAK ONLY COUNTS AS WEAK ONCE WE KNOW ENOUGH");
const weakThin = computeReadiness({ license_valid: false }, {});
ok(weakThin.disqualifiers.length > 0, "an invalid licence is critical even on one answer");
const weakKnown = computeReadiness(
  { license_valid: true, trips_completed: 10, rating: 4.1, platforms: [] },
  { gig_account_status: "active", months_on_platform: 1, license_years: 1,
    has_personal_insurance: false, accidents_last_3yr: 3, license_points: 8,
    has_dui: false, major_violations: true, drive_type: "part_time" },
);
ok(weakKnown.coverage >= THRESHOLDS.ATTENTION_COVERAGE, "plenty known");
ok(weakKnown.qualification < THRESHOLDS.ATTENTION_QUALIFICATION, "  and it reads badly");
eq(weakKnown.state, "needs_attention", "  so the state is Needs Attention");

console.log("\nHOT PROSPECT NEEDS ALL THREE (item 17)");
eq(isHotProspect(perfect), true, "qualification + coverage + no concern = hot");
eq(isHotProspect(highQualLowCov), false, "qualification alone is not enough");
eq(isHotProspect(highQualMidCov), false, "coverage below the floor is not enough");
eq(isHotProspect(computeReadiness({}, {})), false, "an empty application is never hot");
ok(perfect.qualification >= HOT_PROSPECT.MIN_QUALIFICATION, "the rule reads qualification");
ok(perfect.coverage >= HOT_PROSPECT.MIN_COVERAGE, "  and coverage");

console.log("\nHOT PROSPECT IS NOT APPROVAL");
ok(isHotProspect(highQualMidCov) === false || highQualMidCov.state !== "decision_ready",
   "hot and Decision Ready are independent properties");
eq(typeof isHotProspect(perfect), "boolean", "Hot Prospect is a boolean, never a score");

console.log("\nBOTH DOCUMENT VOCABULARIES COUNT");
const vaultNames = computeReadiness({}, {}, [
  { category: "insurance", is_current: true },
  { category: "gig_profile", is_current: true },
]);
const legacyNames = computeReadiness({}, {}, [
  { doc_type: "insurance_card" },
  { doc_type: "driver_profile_screenshot" },
]);
eq(f(vaultNames, "insurance_doc").state, "positive", "the vault's 'insurance' counts");
eq(f(legacyNames, "insurance_doc").state, "positive", "so does lead_documents' 'insurance_card'");
eq(vaultNames.coverage, legacyNames.coverage, "the two vocabularies give identical coverage");

console.log("\nA STAFF-CHECKED DOCUMENT IS BETTER EVIDENCE, NOT MORE POINTS");
const justUploaded = computeReadiness({}, {}, [{ category: "license_front", is_current: true }]);
const staffChecked = computeReadiness({}, {}, [
  { category: "license_front", is_current: true, review_status: "verified" },
]);
eq(f(justUploaded, "license_doc").evidence, "document", "an upload is document evidence");
eq(f(staffChecked, "license_doc").evidence, "staff_verified", "a checked upload is staff-verified");
eq(f(justUploaded, "license_doc").earned, f(staffChecked, "license_doc").earned,
   "  and it earns exactly the same points either way");
eq(justUploaded.coverage, staffChecked.coverage, "  and the same known coverage");
eq(staffChecked.verifiedCoverage, justUploaded.verifiedCoverage,
   "  document and staff-verified both count as verified coverage");

console.log("\nA REJECTED DOCUMENT IS NOT EVIDENCE");
const rejected = computeReadiness({}, {}, [
  { category: "license_front", is_current: true, review_status: "rejected" },
]);
eq(f(rejected, "license_doc").state, "unknown", "a rejected licence reads as no licence on file");
eq(f(rejected, "license_doc").earned, 0, "  and earns nothing");
eq(rejected.disqualifiers.length, 0, "  but is not a concern either — it is a gap");
const superseded = computeReadiness({}, {}, [
  { category: "license_front", is_current: false },
]);
eq(f(superseded, "license_doc").state, "unknown", "a replaced version does not count");

console.log("\nDOCUMENTS RAISE COVERAGE AND VERIFICATION, NOT QUALIFICATION");
const noDocs = computeReadiness({ license_valid: true }, {}, []);
const withDoc = computeReadiness({ license_valid: true }, {}, [{ doc_type: "license_front" }]);
ok(withDoc.coverage > noDocs.coverage, "a licence image raises known coverage");
ok(withDoc.verifiedCoverage > noDocs.verifiedCoverage, "  and verified coverage");
eq(withDoc.disqualifiers.length, 0, "  and raises no concern");
const vaultInsurance = computeReadiness({}, {}, [{ doc_type: "insurance_card" }]);
eq(f(vaultInsurance, "insurance_doc").state, "positive", "a vault insurance card counts");
eq(f(vaultInsurance, "insurance_doc").evidence, "document", "  as document evidence");
eq(f(computeReadiness({}, {}, [{ doc_type: "" }]), "license_doc").state, "unknown",
   "a blank doc_type counts for nothing");

console.log("\nBATCH INDEX MATCHES THE SINGLE COMPUTATION");
const apps = [
  { id: "a", license_valid: true, trips_completed: 900, rating: 4.9 },
  { id: "b", license_valid: true },
  { id: "c" },
];
const idx = buildReadinessIndex(
  apps,
  [{ lead_id: "a", gig_account_status: "active" }],
  [{ lead_id: "a", doc_type: "license_front" }],
);
eq(idx.size, 3, "every application gets a result");
eq(JSON.stringify(idx.get("a")),
   JSON.stringify(computeReadiness(apps[0], { lead_id: "a", gig_account_status: "active" },
                                   [{ lead_id: "a", doc_type: "license_front" }])),
   "a row with a screening and a document matches computeReadiness exactly");
eq(JSON.stringify(idx.get("b")), JSON.stringify(computeReadiness(apps[1], null, [])),
   "a row with neither matches the empty-input computation");
eq(idx.get("c").qualification, null, "an applicant with nothing recorded has no qualification");
eq(idx.get("c").state, "more_info_needed", "  and is More Info Needed, not Needs Attention");
eq(buildReadinessIndex([{ license_valid: true }], [], []).size, 0, "a row with no id is skipped");

console.log("\nHISTORICAL OUTCOMES NEVER ENTER THE CALCULATION (item 17)");
const base = { license_valid: true, trips_completed: 900, rating: 4.9 };
const asActive = computeReadiness(
  { ...base, status: "active", reviewed_at: "2026-01-01", deposit_paid: 500, score: 47 },
  {},
);
const asNew = computeReadiness({ ...base, status: "partial", score: 0 }, {});
eq(JSON.stringify(asActive), JSON.stringify(asNew),
   "an approved, active, deposit-paying renter scores identically to a brand new applicant");

console.log("\nDETERMINISM");
const a = { license_valid: true, rating: 4.9, trips_completed: 800 };
eq(JSON.stringify(computeReadiness(a, {})), JSON.stringify(computeReadiness(a, {})), "same input, same output");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
