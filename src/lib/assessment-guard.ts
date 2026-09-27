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

export type SanitizedAssessment = Assessment & {
  /** Sentences and flags that were dropped, for the log. */
  removed: string[];
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

/** The model asserting an outcome rather than describing an applicant. */
const VERDICT =
  /\b(recommend\w*\s+(?:approv\w*|declin\w*|reject\w*|denial|denying)|should (?:be )?(?:approv\w*|declin\w*|reject\w*|denied)|(?:approve|decline|reject|deny)\s+(?:this|the)\s+(?:applicant|application|driver)|not (?:approved|eligible|a fit)|do not (?:approve|rent)|disqualif\w*)\b/i;

function offends(text: string): "threshold" | "verdict" | null {
  if (VERDICT.test(text)) return "verdict";
  if (NUMERIC_BAR.test(text)) return "threshold";
  if (REQUIREMENT.test(text) && TRIPS.test(text)) return "threshold";
  return null;
}

/**
 * A flag is a slug, so `below_200_trips` has to read as words before any of
 * the patterns above can see it.
 */
function flagAsProse(flag: string): string {
  return flag.replace(/[_\-.]+/g, " ").trim();
}

export function sanitizeAssessment(input: Assessment): SanitizedAssessment {
  const removed: string[] = [];

  const flags = input.flags.filter((flag) => {
    const why = offends(flagAsProse(flag));
    if (why) removed.push(`flag:${flag} (${why})`);
    return !why;
  });

  // Keep the sentence boundaries so a kept sentence reads as it was written.
  const sentences = (input.summary ?? "").split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const kept = sentences.filter((sentence) => {
    const why = offends(sentence);
    if (why) removed.push(`summary:${sentence.trim()} (${why})`);
    return !why;
  });

  const summary = kept.join(" ").trim();
  return {
    summary: summary || (removed.length ? EMPTY_SUMMARY : ""),
    flags,
    removed,
  };
}
