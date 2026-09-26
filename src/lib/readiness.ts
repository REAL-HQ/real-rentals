// Deterministic applicant readiness — CALIBRATION BUILD.
//
// Nothing imports this yet. It is the pure model proposed in the scoring
// audit, written so it can be run against real applicants and argued with
// before any of it reaches a screen or a column.
//
// ---------------------------------------------------------------------------
// The three questions this answers separately, because conflating them is what
// broke the old score
//
//   QUALIFICATION  Of the things we actually know, how good do they look?
//                  Unknowns are excluded from the numerator AND the
//                  denominator. Never asked a question -> never penalised.
//
//   COVERAGE       How much of what matters do we know at all?
//
//   VERIFICATION   How much of what we know is more than the applicant's own
//                  word — a document on file, or a fact a staff member
//                  established during the interview?
//
// A thin application can score 100 qualification. That is honest: of the four
// things we know, four are good. It is also useless on its own, which is why
// coverage travels with it and why the headline state below refuses to call
// such an applicant ready.
//
// ---------------------------------------------------------------------------
// The rule that governs every factor
//
//   POSITIVE   known and favourable            -> earns its weight
//   ATTENTION  known and concerning            -> earns nothing, names the concern
//   UNKNOWN    not supplied, or unreadable     -> excluded from the maths
//
// No factor may infer a fact from a null. A missing accident count is not a
// clean record; a missing rating is not a bad rating. This is the single
// correctness rule of the module and every factor below obeys it.

export type Evidence = "self_reported" | "document" | "staff_verified";
export type FactorState = "positive" | "attention" | "unknown";

export type FactorResult = {
  key: string;
  label: string;
  group: string;
  weight: number;
  state: FactorState;
  /** Null when unknown — there is no evidence for something nobody supplied. */
  evidence: Evidence | null;
  earned: number;
  /** One short phrase for the UI, never raw point arithmetic. */
  detail: string;
};

export type ReadinessState =
  | "ready_for_review"
  | "promising_more_info"
  | "needs_review"
  | "needs_attention"
  | "too_early";

export type ReadinessResult = {
  /** 0–100, of what is known. Unknowns excluded from the denominator. */
  qualification: number;
  /** 0–100, share of total factor weight that is known. */
  coverage: number;
  /** 0–100, share of total factor weight known from a document or staff. */
  verifiedCoverage: number;
  /**
   * 0–100 single number for ranking only.
   * Shrunk toward neutral in proportion to what is unknown — see below.
   */
  composite: number;
  state: ReadinessState;
  stateLabel: string;
  factors: FactorResult[];
  positives: FactorResult[];
  attention: FactorResult[];
  unknowns: FactorResult[];
  /** Hard eligibility problems. Never scored — surfaced for a human. */
  disqualifiers: string[];
};

/** Anything this module reads. Wizard row and screening row, both optional-ish. */
export type ReadinessInput = Record<string, unknown>;

// ---------------------------------------------------------------- helpers

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);

/**
 * Clock seam. The model is otherwise pure; only "how soon does this person
 * need a car" depends on today. Tests freeze it so the calibration is
 * reproducible.
 */
let clock: () => number = () => Date.now();
const now = () => clock();
export function setClockForTests(fn: () => number) {
  clock = fn;
}

type Verdict = { state: FactorState; evidence?: Evidence; detail: string; partial?: number };

const positive = (detail: string, evidence: Evidence, partial = 1): Verdict => ({
  state: "positive",
  evidence,
  detail,
  partial,
});
const attention = (detail: string, evidence: Evidence): Verdict => ({
  state: "attention",
  evidence,
  detail,
});
const unknown = (detail: string): Verdict => ({ state: "unknown", detail });

type Factor = {
  key: string;
  label: string;
  group: string;
  weight: number;
  evaluate: (a: ReadinessInput, s: ReadinessInput) => Verdict;
};

// ---------------------------------------------------------------- factors
//
// Weights total 100 and express how much each fact should move a hiring
// decision, not how hard it is to collect. Staff-established facts and
// self-reported ones share a weight: what changes with evidence quality is
// verification coverage, not how good the applicant looks.

export const FACTORS: Factor[] = [
  // ---- Gig work: the core of whether this person can earn -------------- 30
  {
    key: "gig_account",
    label: "Gig account",
    group: "Gig work",
    weight: 10,
    evaluate: (a, s) => {
      const st = s.gig_account_status;
      if (st === "active") return positive("Active gig account", "staff_verified");
      if (st === "deactivated") return attention("Gig account deactivated", "staff_verified");
      if (st === "pending") return positive("Gig account pending", "staff_verified", 0.4);
      const g = a.gig_status;
      if (g === "Yes, already driving" || g === "Yes")
        return positive("Already driving", "self_reported");
      if (g === "Not yet, ready to start" || g === "Pending")
        return positive("Ready to start, not yet driving", "self_reported", 0.4);
      return unknown("Gig account status not established");
    },
  },
  {
    key: "trip_volume",
    label: "Trip volume",
    group: "Gig work",
    weight: 8,
    evaluate: (a, s) => {
      const staff = num(s.trip_count);
      const self = num(a.trips_completed);
      const shots = Array.isArray(a.trip_screenshots)
        ? a.trip_screenshots.filter(Boolean).length
        : 0;
      const n = staff ?? self;
      if (n === null) return unknown("Trip count not provided");
      // A screenshot is what turns a claim into something we can check.
      const evidence: Evidence =
        staff !== null ? "staff_verified" : shots > 0 ? "document" : "self_reported";
      const band = n >= 1000 ? 1 : n >= 500 ? 0.8 : n >= 200 ? 0.6 : n >= 50 ? 0.3 : 0;
      if (band === 0) return attention(`Only ${n} trips completed`, evidence);
      return positive(`${n.toLocaleString()} trips`, evidence, band);
    },
  },
  {
    key: "driver_rating",
    label: "Driver rating",
    group: "Gig work",
    weight: 7,
    evaluate: (a, s) => {
      const staff = num(s.driver_rating);
      const self = num(a.rating);
      const r = staff ?? self;
      // Null is not a bad rating. This is the exact conflation being fixed.
      if (r === null) return unknown("Driver rating not provided");
      const evidence: Evidence =
        staff !== null ? "staff_verified" : a.profile_screenshot_url ? "document" : "self_reported";
      if (r < 4.5) return attention(`Rating ${r}`, evidence);
      const band = r >= 4.9 ? 1 : r >= 4.7 ? 0.75 : 0.5;
      return positive(`Rating ${r}`, evidence, band);
    },
  },
  {
    key: "tenure",
    label: "Platform tenure",
    group: "Gig work",
    weight: 3,
    evaluate: (_a, s) => {
      const m = num(s.months_on_platform);
      if (m === null) return unknown("Time on platform not established");
      if (m < 3) return attention(`${m} months on platform`, "staff_verified");
      return positive(`${m} months on platform`, "staff_verified", m >= 12 ? 1 : 0.6);
    },
  },
  {
    key: "platforms",
    label: "Platform breadth",
    group: "Gig work",
    weight: 2,
    evaluate: (a, s) => {
      const fromStaff = Array.isArray(s.gig_apps) ? s.gig_apps.filter(Boolean).length : 0;
      const fromSelf = Array.isArray(a.platforms) ? a.platforms.filter(Boolean).length : 0;
      const n = fromStaff || fromSelf;
      if (!n) return unknown("Platforms not listed");
      const evidence: Evidence = fromStaff ? "staff_verified" : "self_reported";
      return positive(
        `${n} platform${n === 1 ? "" : "s"}`,
        evidence,
        n >= 3 ? 1 : n === 2 ? 0.7 : 0.4,
      );
    },
  },

  // ---- Licence ---------------------------------------------------------- 18
  {
    key: "license_valid",
    label: "Licence valid",
    group: "Licence",
    weight: 10,
    evaluate: (a, s) => {
      const staff = bool(s.license_active);
      if (staff === true) return positive("Licence confirmed active", "staff_verified");
      if (staff === false) return attention("Licence not active", "staff_verified");
      const self = bool(a.license_valid);
      if (self === true) return positive("Licence reported valid", "self_reported");
      if (self === false) return attention("Licence reported invalid", "self_reported");
      return unknown("Licence status not provided");
    },
  },
  {
    key: "license_doc",
    label: "Licence on file",
    group: "Licence",
    weight: 4,
    evaluate: (a) =>
      a.license_photo_url
        ? positive("Licence image on file", "document")
        : unknown("No licence image"),
  },
  {
    key: "license_tenure",
    label: "Years licensed",
    group: "Licence",
    weight: 4,
    evaluate: (a, s) => {
      const y = num(s.license_years) ?? num(a.years_licensed);
      if (y === null) return unknown("Years licensed not provided");
      const evidence: Evidence = num(s.license_years) !== null ? "staff_verified" : "self_reported";
      if (y < 2) return attention(`${y} years licensed`, evidence);
      return positive(`${y} years licensed`, evidence, y >= 5 ? 1 : 0.7);
    },
  },

  // ---- Insurance -------------------------------------------------------- 17
  {
    key: "insurance_cover",
    label: "Insurance cover",
    group: "Insurance",
    weight: 8,
    evaluate: (a, s) => {
      const has = bool(s.has_personal_insurance);
      const active = bool(s.policy_active);
      if (has === true && active === true)
        return positive("Policy confirmed active", "staff_verified");
      if (has === true && active === false) return attention("Policy not active", "staff_verified");
      if (has === false) return attention("No personal insurance", "staff_verified");
      const self = bool(a.full_coverage_insurance);
      // "declared" means they typed a carrier and policy number, nothing more.
      if (self === true)
        return positive(
          "Full coverage declared",
          a.insurance_doc_url ? "document" : "self_reported",
        );
      if (self === false) return attention("No full coverage", "self_reported");
      return unknown("Insurance not provided");
    },
  },
  {
    key: "insurance_doc",
    label: "Insurance document",
    group: "Insurance",
    weight: 4,
    evaluate: (a, s) => {
      if (bool(s.insurance_verified) === true)
        return positive("Insurance verified by staff", "staff_verified");
      if (a.insurance_doc_url) return positive("Insurance document on file", "document");
      return unknown("No insurance document");
    },
  },
  {
    key: "rideshare_endorsement",
    label: "Rideshare endorsement",
    group: "Insurance",
    weight: 3,
    evaluate: (a, s) => {
      const st = bool(s.rideshare_endorsement);
      if (st === true) return positive("Rideshare endorsement confirmed", "staff_verified");
      if (st === false) return attention("No rideshare endorsement", "staff_verified");
      const self = bool(a.insurance_rideshare_endorsement);
      if (self === true) return positive("Rideshare endorsement reported", "self_reported");
      if (self === false) return attention("No rideshare endorsement", "self_reported");
      return unknown("Endorsement not established");
    },
  },
  {
    key: "insurance_name",
    label: "Policy name matches",
    group: "Insurance",
    weight: 2,
    evaluate: (_a, s) => {
      const m = bool(s.insurance_name_matches_license);
      if (m === true) return positive("Policy name matches licence", "staff_verified");
      if (m === false) return attention("Policy name does not match licence", "staff_verified");
      return unknown("Name match not checked");
    },
  },

  // ---- Driving history — all four are staff-only, all four stay unknown
  //      until somebody asks. Nothing here may be inferred from a null. -- 20
  {
    key: "dui",
    label: "DUI history",
    group: "Driving history",
    weight: 7,
    evaluate: (_a, s) => {
      const d = bool(s.has_dui);
      if (d === false) return positive("No DUI on record", "staff_verified");
      if (d === true) return attention("DUI on record", "staff_verified");
      return unknown("DUI history not checked");
    },
  },
  {
    key: "violations",
    label: "Major violations",
    group: "Driving history",
    weight: 5,
    evaluate: (_a, s) => {
      const v = bool(s.major_violations);
      if (v === false) return positive("No major violations", "staff_verified");
      if (v === true) return attention("Major violations on record", "staff_verified");
      return unknown("Violations not checked");
    },
  },
  {
    key: "accidents",
    label: "Recent accidents",
    group: "Driving history",
    weight: 5,
    evaluate: (_a, s) => {
      const n = num(s.accidents_last_3yr);
      // The old screening scored null as zero accidents and paid 10 points
      // for it. A question nobody asked is not a clean record.
      if (n === null) return unknown("Accident history not checked");
      if (n === 0) return positive("No accidents in 3 years", "staff_verified");
      return attention(`${n} accident${n === 1 ? "" : "s"} in 3 years`, "staff_verified");
    },
  },
  {
    key: "points",
    label: "Licence points",
    group: "Driving history",
    weight: 3,
    evaluate: (_a, s) => {
      const n = num(s.license_points);
      if (n === null) return unknown("Licence points not checked");
      if (n === 0) return positive("No licence points", "staff_verified");
      return n <= 3
        ? positive(`${n} licence points`, "staff_verified", 0.4)
        : attention(`${n} licence points`, "staff_verified");
    },
  },

  // ---- Commitment and ability to transact ------------------------------- 15
  {
    key: "drive_type",
    label: "Driving commitment",
    group: "Commitment",
    weight: 4,
    evaluate: (_a, s) => {
      const t = s.drive_type;
      if (t === "full_time") return positive("Full-time driver", "staff_verified");
      if (t === "part_time") return positive("Part-time driver", "staff_verified", 0.5);
      return unknown("Full or part time not established");
    },
  },
  {
    key: "timing",
    label: "Vehicle timing",
    group: "Commitment",
    weight: 4,
    evaluate: (a, s) => {
      const target = typeof s.needed_by_date === "string" ? Date.parse(s.needed_by_date) : NaN;
      if (Number.isFinite(target)) {
        const days = Math.ceil((target - now()) / 864e5);
        // A target date that has already gone by is not urgency, it is a stale
        // answer. Fall through to the stated timing rather than reading a
        // months-old date as "needs a vehicle today".
        if (days >= 0 && days <= 14)
          return positive(`Needs a vehicle within ${days} days`, "staff_verified");
        if (days > 14) return positive("Has a target date", "staff_verified", 0.5);
      }
      const t = a.start_timing;
      if (t === "Today" || t === "This week")
        return positive(`Wants to start ${String(t).toLowerCase()}`, "self_reported");
      if (t === "Within 2 weeks")
        return positive("Wants to start within 2 weeks", "self_reported", 0.6);
      // Browsing is a real signal about intent, not a missing answer.
      if (t === "Just checking options") return attention("Just checking options", "self_reported");
      return unknown("Timing not provided");
    },
  },
  {
    key: "payment_ready",
    label: "Payment method",
    group: "Commitment",
    weight: 4,
    evaluate: (a, s) => {
      const own = bool(s.card_in_own_name);
      if (own === false) return attention("Card not in driver's name", "staff_verified");
      if (a.card_last4 || a.card_on_file_at) return positive("Card on file", "document");
      if (own === true) return positive("Card confirmed in own name", "staff_verified");
      return unknown("No payment method yet");
    },
  },
  {
    key: "rate_confirmed",
    label: "Rate agreed",
    group: "Commitment",
    weight: 3,
    evaluate: (_a, s) => {
      const r = bool(s.rate_confirmed);
      if (r === true) return positive("Rate confirmed", "staff_verified");
      if (r === false) return attention("Rate not accepted", "staff_verified");
      return unknown("Rate not discussed");
    },
  },
];

export const TOTAL_WEIGHT = FACTORS.reduce((a, f) => a + f.weight, 0);

// ------------------------------------------------------------ disqualifiers
//
// Hard eligibility problems. Deliberately outside the score: an under-age
// applicant is not "low scoring", they are ineligible, and burying that in an
// average would hide it. Surfaced for a human; nothing is decided here.

function findDisqualifiers(a: ReadinessInput, s: ReadinessInput): string[] {
  const out: string[] = [];
  const age = num(s.driver_age);
  if (age !== null && age < 21) out.push("Driver under 21");
  if (bool(s.license_active) === false) out.push("Licence not active");
  if (bool(s.has_dui) === true) out.push("DUI on record");
  if (s.gig_account_status === "deactivated") out.push("Gig account deactivated");
  if (bool(s.card_in_own_name) === false) out.push("Payment card not in driver's name");
  if (bool(s.has_personal_insurance) === true && bool(s.insurance_name_matches_license) === false) {
    out.push("Insurance name does not match licence");
  }
  if (bool(a.license_valid) === false) out.push("Licence reported invalid");
  return out;
}

// --------------------------------------------------------------- the model

/** Coverage below this and we are guessing, however good the answers look. */
export const MIN_COVERAGE_FOR_CONFIDENCE = 60;
/** Neutral prior for the ranking composite: unknown means average, not bad. */
export const NEUTRAL_PRIOR = 0.5;

export function computeReadiness(
  app: ReadinessInput,
  screening: ReadinessInput | null = null,
): ReadinessResult {
  const s = screening ?? {};
  const factors: FactorResult[] = FACTORS.map((f) => {
    const v = f.evaluate(app, s);
    const earned = v.state === "positive" ? f.weight * (v.partial ?? 1) : 0;
    return {
      key: f.key,
      label: f.label,
      group: f.group,
      weight: f.weight,
      state: v.state,
      evidence: v.evidence ?? null,
      earned: Math.round(earned * 100) / 100,
      detail: v.detail,
    };
  });

  const known = factors.filter((f) => f.state !== "unknown");
  const knownWeight = known.reduce((a, f) => a + f.weight, 0);
  const earned = known.reduce((a, f) => a + f.earned, 0);
  const verifiedWeight = known
    .filter((f) => f.evidence === "document" || f.evidence === "staff_verified")
    .reduce((a, f) => a + f.weight, 0);

  // Of what we know. An applicant with nothing known has no qualification —
  // not a zero, which would read as "bad".
  const qualification = knownWeight > 0 ? (earned / knownWeight) * 100 : 0;
  const coverage = (knownWeight / TOTAL_WEIGHT) * 100;
  const verifiedCoverage = (verifiedWeight / TOTAL_WEIGHT) * 100;

  // Ranking number only. Unknown weight is counted at the neutral prior, so a
  // thin-but-positive application lands mid-scale rather than at the top:
  //   composite = qualification x coverage + 50 x (1 - coverage)
  const c = knownWeight / TOTAL_WEIGHT;
  const composite = (qualification / 100) * c * 100 + NEUTRAL_PRIOR * (1 - c) * 100;

  const disqualifiers = findDisqualifiers(app, s);
  const byWeight = (x: FactorResult, y: FactorResult) => y.weight - x.weight || y.earned - x.earned;
  const attentionList = factors.filter((f) => f.state === "attention").sort(byWeight);

  return {
    qualification: Math.round(qualification),
    coverage: Math.round(coverage),
    verifiedCoverage: Math.round(verifiedCoverage),
    composite: Math.round(composite),
    ...classify(qualification, coverage, attentionList.length, disqualifiers.length),
    factors,
    positives: factors.filter((f) => f.state === "positive").sort(byWeight),
    attention: attentionList,
    unknowns: factors.filter((f) => f.state === "unknown").sort(byWeight),
    disqualifiers,
  };
}

/**
 * The headline state.
 *
 * Two numbers cannot stop somebody reading "95" and acting on it, so the state
 * is what the UI leads with, and it refuses to say ready without the coverage
 * to back it. This is the guard against a thin application looking finished.
 */
function classify(
  qualification: number,
  coverage: number,
  attentionCount: number,
  dqCount: number,
): { state: ReadinessState; stateLabel: string } {
  if (dqCount > 0) return { state: "needs_attention", stateLabel: "Needs Attention" };
  if (coverage < 20) return { state: "too_early", stateLabel: "Too Early To Tell" };
  if (qualification < 50) return { state: "needs_attention", stateLabel: "Needs Attention" };
  if (coverage < MIN_COVERAGE_FOR_CONFIDENCE) {
    return qualification >= 75
      ? { state: "promising_more_info", stateLabel: "Promising — More Info Needed" }
      : { state: "needs_review", stateLabel: "Needs Review" };
  }
  if (qualification >= 75 && attentionCount === 0) {
    return { state: "ready_for_review", stateLabel: "Ready For Review" };
  }
  return { state: "needs_review", stateLabel: "Needs Review" };
}
