/**
 * What the AI second opinion is not allowed to put in the record.
 *
 * The rubric asks the model not to state an eligibility threshold and not to
 * decide anything. An instruction in a prompt is a request, not a guarantee,
 * and both of the fields it produces — `ai_summary` and `ai_flags` — are
 * free-form text that lands in the application row and is rendered on the
 * applicant's record for staff to read. A model that writes "below our
 * 200-trip minimum" has put a published-sounding requirement into the business
 * record by the side door, and a staff member may well repeat it to the
 * applicant on the phone.
 *
 * So the two rules are enforced here, after the model has spoken and before
 * anything is stored:
 *
 *  1. No eligibility threshold. 200 completed trips is an internal readiness
 *     signal; REAL RENTALS may be flexible on it and publishes no trip
 *     requirement.
 *  2. No verdict. A human decides. The model may describe an applicant; it may
 *     not recommend approving or declining one.
 *
 * Offending sentences are removed rather than reworded — rewriting somebody
 * else's assessment is how you end up with a sentence nobody wrote and
 * everybody trusts. What was removed is reported back so the caller can log
 * it and so staff can see that filtering happened at all.
 */

export type Assessment = { summary: string; flags: string[] };

/**
 * What was dropped, described without quoting it.
 *
 * Deliberately carries no text. The whole point of a removal is that the
 * string was not fit to keep, and a log line is not a safer place for it than
 * the database — logs are retained, shipped and read by more people. The
 * offending prose can also be about a named applicant, so quoting it would put
 * their name, and whatever else the model chose to mention, into engineering
 * logs for a filtering event.
 *
 * `rule` says which pattern fired, `index` and `length` say where and how much
 * — enough to reproduce against the stored row and to tell a one-word flag
 * from a paragraph, without the content itself.
 */
export type Removal = {
  field: "summary" | "flag";
  reason: "threshold" | "verdict";
  rule: "numeric_bar" | "requirement_near_trips" | "verdict_language";
  /** Sentence index within the summary, or position within the flags array. */
  index: number;
  /** Characters dropped. Shape, not content. */
  length: number;
};

export type SanitizedAssessment = Assessment & {
  /** Non-verbatim diagnostics for the log. Never contains the dropped text. */
  removed: Removal[];
};

/** Shown when filtering leaves nothing behind. Says so, rather than inventing. */
const EMPTY_SUMMARY =
  "Assessment withheld: the generated summary stated an eligibility threshold or a decision, neither of which this tool makes.";

/** Words that turn a mention of trips into a bar somebody has to clear. */
const REQUIREMENT =
  /\b(minimum|minimums|at least|required|requires|requirement|requirements|threshold|cut[- ]?off|qualif\w*|eligib\w*|benchmark|insufficient|inadequate|too few|not enough|fewer than|less than|falls? short|does ?n[o']t meet|do ?n[o']t meet|fails? to meet|short of|below (?:our|the)|under (?:our|the))\b/i;

const TRIPS = /\b(trips?|deliveries|delivery|ride[s]?|trip[- ]count)\b/i;

/**
 * A comparator sitting directly on a number and a trip count — "below 200
 * trips", "under 500 deliveries".
 *
 * Only falling-short comparators. "Over 2,000 deliveries" is praise and
 * "at least" here means a floor, so the two are not symmetrical: exceeding a
 * number is a description, missing one is a bar.
 *
 * Adjacency matters too. "Rating below 4.5 with 900 trips" is an honest
 * sentence about two unrelated numbers, and a looser rule would eat it — so
 * the number has to sit directly on the word "trips".
 */
const NUMERIC_BAR =
  /\b(below|under|fewer than|less than|at least|minimum of|min\.?)\s+(?:our\s+|the\s+)?[\d,]+\+?\s*[-\s]?\s*(trips?|deliveries|delivery|ride[s]?)\b/i;

/**
 * The model asserting an outcome rather than describing an applicant.
 *
 * Covers the eligibility determinations too — "does not qualify", "not
 * eligible" — because those are the same decision in a quieter voice, and they
 * arrive without mentioning trips at all, so the threshold rule never sees
 * them.
 */
const VERDICT = new RegExp(
  [
    "recommend\\w*\\s+(?:approv\\w*|declin\\w*|reject\\w*|denial|denying)",
    "should (?:be )?(?:approv\\w*|declin\\w*|reject\\w*|denied)",
    "(?:approve|decline|reject|deny)\\s+(?:this|the)\\s+(?:applicant|application|driver)",
    "do(?:es)? ?n[o']?t\\s+(?:qualify|meet)",
    "(?:is |are )?not (?:qualified|eligible|approved|a fit)",
    "\\bineligible\\b",
    "do not (?:approve|rent)",
    "disqualif\\w*",
  ].join("|"),
  "i",
);

/**
 * `below_200_trips` has to read as words before any pattern can see it.
 *
 * Applied to summary sentences as well as flags. A flag is always a slug, but
 * nothing stops a model dropping one into its prose, and the first version of
 * this filter let exactly that through.
 */
function asProse(text: string): string {
  return text.replace(/[_\-.]+/g, " ").trim();
}

function offends(text: string): { reason: Removal["reason"]; rule: Removal["rule"] } | null {
  const prose = asProse(text);
  if (VERDICT.test(prose)) return { reason: "verdict", rule: "verdict_language" };
  if (NUMERIC_BAR.test(prose)) return { reason: "threshold", rule: "numeric_bar" };
  if (REQUIREMENT.test(prose) && TRIPS.test(prose))
    return { reason: "threshold", rule: "requirement_near_trips" };
  return null;
}

export function sanitizeAssessment(input: Assessment): SanitizedAssessment {
  const removed: Removal[] = [];

  const flags = (input.flags ?? []).filter((flag, index) => {
    const why = offends(flag);
    if (why) removed.push({ field: "flag", ...why, index, length: flag.length });
    return !why;
  });

  // Split on sentence boundaries so a kept sentence reads as it was written.
  const sentences = (input.summary ?? "").split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const kept = sentences.filter((sentence, index) => {
    const why = offends(sentence);
    if (why) removed.push({ field: "summary", ...why, index, length: sentence.trim().length });
    return !why;
  });

  const summary = kept.join(" ").trim();
  return {
    summary: summary || (removed.some((r) => r.field === "summary") ? EMPTY_SUMMARY : ""),
    flags,
    removed,
  };
}
