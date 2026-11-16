/**
 * FLEET applicant review: the rules, with no I/O (client-safe, testable).
 *
 * Two lists come out of an applicant's review packet:
 *
 *   HARD BLOCKERS  FLEET's approve is refused while any exists. Missing
 *                  required documents, a known disqualifying fact, an
 *                  application that is not submitted or is not in a stage
 *                  FLEET may approve, an open Needs Staff flag, and so on.
 *
 *   ESCALATIONS    The default checklist of reasons FLEET should send the
 *                  applicant to staff (needs_staff) instead of approving.
 *                  Advisory: FLEET decides, the server does not enforce them.
 *
 * Nothing here marks anyone insured, verified or screened. Insurance and
 * background-check values are reported exactly as recorded.
 */
import { REQUIRED_VAULT_CATEGORIES } from "@/lib/required-docs";

export const FLEET_ACTOR_LABEL = "FLEET (automated)";

/** Stages an applicant is "awaiting review" in (submitted, not yet decided). */
export const FLEET_REVIEW_STAGES = ["new", "reviewing", "complete"] as const;

/**
 * Vault categories FLEET needs before it may approve. Income proof is advisory
 * (required-docs.ts: "remains advisory for activation"), so a missing income
 * document is an escalation, not a blocker.
 */
export const FLEET_HARD_DOC_CATEGORIES = ["license_front", "license_back", "gig_profile"] as const;
export const FLEET_ADVISORY_DOC_CATEGORIES = REQUIRED_VAULT_CATEGORIES.filter(
  (c) => !(FLEET_HARD_DOC_CATEGORIES as readonly string[]).includes(c),
);

/** Recorded screening outcomes that block an automated approval. */
const BAD_CHECK = /^(fail|failed|flag|flagged|consider|adverse|rejected|declined|suspended|denied)$/i;
const GOOD_CHECK = /^(pass|passed|clear|cleared|approved|ok)$/i;

/** Default thresholds for the escalation checklist (proposed; Dolmar can change). */
export const FLEET_ESCALATION_DEFAULTS = {
  /** Under this age (from date of birth) -> staff look. 21+ is the hard floor. */
  youngDriverAge: 25,
  minAge: 21,
  /** Gig rating below this -> staff look. */
  minRating: 4.7,
  /** Fewer completed trips than this -> staff look. */
  minTrips: 100,
  /** License expiring within this many days -> staff look (expired = blocker). */
  licenseExpiryDays: 30,
} as const;

export type FleetDoc = {
  id?: string | null;
  category?: string | null;
  review_status?: string | null;
  is_current?: boolean | null;
  created_at?: string | null;
};

export type FleetReviewInput = {
  app: Record<string, any>;
  screening: Record<string, any> | null;
  docs: readonly FleetDoc[];
  /** Readiness disqualifiers from computeReadiness (src/lib/readiness.ts). */
  disqualifiers: readonly string[];
  readinessState: string | null;
  /** An unresolved FLEET Needs Staff flag on this applicant, if any. */
  openNeedsStaff: { reason: string; created_at: string | null } | null;
  /** Other applications with the same phone or email that were declined or closed. */
  priorDeclined: number;
  now: Date;
};

export type ReviewItem = { code: string; message: string };

export type FleetReviewAssessment = {
  submitted: boolean;
  docs: { have: string[]; missing_required: string[]; missing_advisory: string[]; unreviewed: string[]; rejected: string[] };
  hard_blockers: ReviewItem[];
  escalations: ReviewItem[];
  /** Facts worth knowing that do not, by default, need staff. */
  notes: ReviewItem[];
  /** What the default checklist suggests. FLEET decides. */
  recommendation: "approve" | "needs_staff" | "not_ready";
  ready_for_review: boolean;
};

function ageOn(dob: unknown, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob ?? ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age >= 0 && age < 120 ? age : null;
}

function daysUntil(date: unknown, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((t - today) / 86400000);
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && String(v).trim() !== "" ? n : null;
}

/** Current, non-rejected vault categories, plus the per-category review picture. */
export function docPicture(docs: readonly FleetDoc[]) {
  const have = new Set<string>();
  const reviewed = new Set<string>();
  const rejected = new Set<string>();
  for (const d of docs) {
    if (d?.is_current === false) continue;
    const c = String(d?.category ?? "").trim();
    if (!c) continue;
    if (d.review_status === "rejected") { rejected.add(c); continue; }
    have.add(c);
    if (d.review_status === "verified") reviewed.add(c);
  }
  // A later good upload replaces a rejected one.
  for (const c of have) rejected.delete(c);
  const missing_required = FLEET_HARD_DOC_CATEGORIES.filter((c) => !have.has(c));
  const missing_advisory = FLEET_ADVISORY_DOC_CATEGORIES.filter((c) => !have.has(c));
  const unreviewed = [...FLEET_HARD_DOC_CATEGORIES].filter((c) => have.has(c) && !reviewed.has(c));
  return { have: [...have].sort(), missing_required: [...missing_required], missing_advisory: [...missing_advisory], unreviewed, rejected: [...rejected].sort() };
}

/** The submitted application with the hard documents on file: what review needs. */
export function readyForReview(app: Record<string, any>, docs: readonly FleetDoc[]): boolean {
  if (!app || app.deleted_at) return false;
  if (!(FLEET_REVIEW_STAGES as readonly string[]).includes(String(app.status ?? "").toLowerCase())) return false;
  return docPicture(docs).missing_required.length === 0;
}

export function assessForFleet(input: FleetReviewInput): FleetReviewAssessment {
  const { app, now } = input;
  const s = input.screening ?? {};
  const status = String(app.status ?? "").toLowerCase();
  const docs = docPicture(input.docs);
  const blockers: ReviewItem[] = [];
  const esc: ReviewItem[] = [];
  const notes: ReviewItem[] = [];
  const note = (code: string, message: string) => notes.push({ code, message });
  const block = (code: string, message: string) => blockers.push({ code, message });
  const flag = (code: string, message: string) => esc.push({ code, message });
  const T = FLEET_ESCALATION_DEFAULTS;

  // ---- hard blockers
  const submitted = (FLEET_REVIEW_STAGES as readonly string[]).includes(status);
  if (app.deleted_at) block("deleted", "This application was deleted.");
  if (app.legal_hold === true) block("legal_hold", "This application is on legal hold.");
  if (status === "approved") block("already_approved", "Already approved.");
  else if (status === "partial") block("not_submitted", "The application is not finished (Partial).");
  else if (!submitted) block("stage_not_reviewable", `FLEET can only approve New, Reviewing or Complete applications (this one is ${status || "blank"}).`);
  if (app.primary_application_id) block("duplicate", "This is a duplicate of another application.");
  if (!String(app.email ?? "").trim()) block("no_email", "No email on file.");
  for (const c of docs.missing_required) block(`missing_${c}`, `Missing required document: ${c.replace(/_/g, " ")}.`);
  for (const c of docs.rejected) block(`rejected_${c}`, `A ${c.replace(/_/g, " ")} document was rejected by staff and not replaced.`);
  for (const d of input.disqualifiers) block("disqualifier", d);
  if (s.disqualified === true) block("screening_disqualified", `Screening marked disqualified${s.disqualification_reason ? `: ${s.disqualification_reason}` : ""}.`);
  for (const [k, label] of [["background_check_status", "Background check"], ["mvr_status", "Driving record (MVR)"]] as const) {
    const v = String(app[k] ?? "").trim();
    if (v && BAD_CHECK.test(v)) block(`${k}_${v.toLowerCase()}`, `${label} recorded as ${v}.`);
  }
  const age = ageOn(app.dob, now);
  if (age !== null && age < T.minAge) block("under_21", `Driver is ${age} (minimum ${T.minAge}).`);
  const licDays = daysUntil(app.license_expiration, now);
  if (licDays !== null && licDays < 0) block("license_expired", "Driver's license is expired.");
  if (app.license_valid === false) block("license_invalid", "Applicant reported the license is not valid.");
  if (input.openNeedsStaff) block("open_needs_staff", `Waiting on staff: ${input.openNeedsStaff.reason}`);

  // ---- default escalation checklist (FLEET's call)
  // Today the call happens after approval, so a missing interview is a note.
  if (!s.interview_completed_at) note("no_interview", "Screening interview not recorded yet.");
  if (input.readinessState === "needs_attention") flag("readiness_attention", "Readiness says Needs Attention.");
  for (const c of docs.missing_advisory) flag(`missing_${c}`, `Advisory document missing: ${c.replace(/_/g, " ")}.`);
  if (docs.unreviewed.length) note("docs_unreviewed", `Not yet reviewed by staff: ${docs.unreviewed.join(", ")}.`);
  if (age === null) flag("no_dob", "No date of birth on file.");
  else if (age < T.youngDriverAge) flag("young_driver", `Driver is ${age}.`);
  if (licDays !== null && licDays >= 0 && licDays <= T.licenseExpiryDays) flag("license_expiring", `License expires in ${licDays} days.`);
  if (licDays === null) flag("no_license_expiry", "No license expiration date on file.");
  const flags = Array.isArray(app.ai_flags) ? app.ai_flags.filter(Boolean) : [];
  if (flags.length) flag("ai_flags", `Application analysis flags: ${flags.map(String).join("; ")}.`);
  const rating = numberOrNull(app.rating ?? s.driver_rating);
  if (rating !== null && rating > 0 && rating < T.minRating) flag("low_rating", `Gig rating ${rating}.`);
  const trips = numberOrNull(app.trips_completed ?? s.trip_count);
  if (trips === null) note("no_trips", "Trip count not known; check the gig screenshot.");
  else if (trips < T.minTrips) flag("few_trips", `${trips} trips completed.`);
  const gig = String(app.gig_status ?? "").toLowerCase();
  if (gig && !gig.startsWith("yes")) flag("not_driving_yet", `Gig status: ${app.gig_status}.`);
  if (String(s.gig_account_status ?? "") === "deactivated") flag("gig_deactivated", "Gig account deactivated.");
  if (Number(app.resubmission_count ?? 0) > 0) flag("resubmitted", `Applied ${Number(app.resubmission_count) + 1} times.`);
  if (input.priorDeclined > 0) flag("prior_declined", `${input.priorDeclined} earlier application(s) with the same phone or email were declined or closed.`);
  for (const [k, label] of [["background_check_status", "Background check"], ["mvr_status", "Driving record (MVR)"]] as const) {
    const v = String(app[k] ?? "").trim();
    // "pending" is today's default for everyone: reported, not escalated.
    if (!v || /^pending$/i.test(v)) note(`${k}_pending`, `${label}: ${v || "not recorded"}.`);
    else if (!BAD_CHECK.test(v) && !GOOD_CHECK.test(v)) flag(`${k}_open`, `${label}: ${v}.`);
  }
  if (s.has_personal_insurance === true && s.insurance_name_matches_license === false) flag("insurance_name", "Insurance name does not match the license.");

  const ready = blockers.length === 0 || (blockers.every((b) => b.code === "open_needs_staff"));
  return {
    submitted,
    docs,
    hard_blockers: blockers,
    escalations: esc,
    notes,
    recommendation: blockers.length ? "not_ready" : esc.length ? "needs_staff" : "approve",
    ready_for_review: ready && readyForReview(app, input.docs),
  };
}
