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
import { REQUIRED_VAULT_CATEGORIES, requirementCategory } from "@/lib/required-docs";

export const FLEET_ACTOR_LABEL = "FLEET (automated)";
/** How a date FLEET read off the license photo is labelled everywhere. Never "verified". */
export const LICENSE_READING_LABEL = "Read by FLEET from license photo";

/** Stages an applicant is "awaiting review" in (submitted, not yet decided). */
export const FLEET_REVIEW_STAGES = ["new", "reviewing", "complete"] as const;

/**
 * Vault categories FLEET needs before it may approve. Income proof is advisory
 * (required-docs.ts: "remains advisory for activation"), so a missing income
 * document is an escalation, not a blocker. The back of the license is an
 * optional upload and is neither a blocker nor an escalation.
 */
export const FLEET_HARD_DOC_CATEGORIES = ["license_front", "gig_profile"] as const;
export const FLEET_ADVISORY_DOC_CATEGORIES = REQUIRED_VAULT_CATEGORIES.filter(
  (c) => !(FLEET_HARD_DOC_CATEGORIES as readonly string[]).includes(c),
);

/**
 * Applicants who answered that they are not driving for a gig app yet ("Not
 * yet, ready to start", "No", "Pending"). They have no gig profile to
 * screenshot, so requiring one kept them out of FLEET's review list forever
 * (the Nov 16 2026 skip: James Spence, Jonathan Simmons). A blank answer is
 * not "not driving": the application is unfinished and keeps the gig rules.
 */
export function notDrivingGigYet(app: Record<string, any> | null | undefined): boolean {
  const g = String(app?.gig_status ?? "").trim().toLowerCase();
  return g !== "" && !g.startsWith("yes");
}

/**
 * The documents FLEET needs before it may review/approve this applicant.
 * Gig drivers: license front + gig profile (income advisory).
 * Not driving yet: license front + proof of income, because there is no gig
 * track record to stand in for it (Dolmar, t339u). The gig profile is not
 * asked for, required or advised.
 */
export const FLEET_NO_TRACK_RECORD_DOC_CATEGORIES = ["license_front", "income"] as const;
export function hardDocCategoriesFor(app: Record<string, any> | null | undefined): readonly string[] {
  return notDrivingGigYet(app) ? FLEET_NO_TRACK_RECORD_DOC_CATEGORIES : FLEET_HARD_DOC_CATEGORIES;
}
function advisoryDocCategoriesFor(app: Record<string, any> | null | undefined): readonly string[] {
  if (notDrivingGigYet(app)) return [];
  return FLEET_ADVISORY_DOC_CATEGORIES;
}

/** Recorded screening outcomes that block an automated approval. */
const BAD_CHECK = /^(fail|failed|flag|flagged|consider|adverse|rejected|declined|suspended|denied)$/i;
const GOOD_CHECK = /^(pass|passed|clear|cleared|approved|ok)$/i;

/** Default thresholds for the escalation checklist (proposed; Dolmar can change). */
export const FLEET_ESCALATION_DEFAULTS = {
  /** Under this age (from date of birth) -> staff look. 21+ is the hard floor. */
  youngDriverAge: 25,
  minAge: 21,
  /** Gig rating below this -> staff look (Dolmar, t299s1618). */
  minRating: 4.0,
  /** Fewer completed trips than this -> staff look (Dolmar, t299s1618: 200 trips and a 4.0 rating). */
  minTrips: 200,
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
  /** The latest FLEET reading of the license photo, if any (fleet-license-facts). */
  licenseReading?: { applied?: string[] | null } | null;
  /**
   * app_settings.fleet_rentid.require_for_approval (OFF by default). When on,
   * FLEET may approve only after a RentID result recorded both checks as
   * passed (background_check_status and mvr_status). See fleet-rentid.server.ts.
   */
  rentidRequired?: boolean;
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
  /**
   * What the default checklist suggests. FLEET decides, except that a flagged
   * background or driving-record result always goes to staff (Dolmar,
   * t299s1618): FLEET cannot approve it (hard blocker) and the recommendation
   * is needs_staff, never not_ready.
   */
  recommendation: "approve" | "needs_staff" | "not_ready";
  /** True when a background or MVR result is flagged: send to staff, never approve. */
  screening_flagged: boolean;
  ready_for_review: boolean;
  /**
   * True when the applicant is not driving for a gig app yet. There is no
   * trip/rating track record, so the server refuses FLEET's approve while any
   * escalation exists (strict approval): FLEET may approve only a clean file.
   */
  no_track_record: boolean;
  /** The documents this applicant needs before FLEET may approve (depends on gig status). */
  required_documents: string[];
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
export function docPicture(docs: readonly FleetDoc[], app?: Record<string, any> | null) {
  const hard = app === undefined ? FLEET_HARD_DOC_CATEGORIES : hardDocCategoriesFor(app);
  const advisory = app === undefined ? FLEET_ADVISORY_DOC_CATEGORIES : advisoryDocCategoriesFor(app);
  const have = new Set<string>();
  const reviewed = new Set<string>();
  const rejected = new Set<string>();
  for (const d of docs) {
    if (d?.is_current === false) continue;
    const c = String(d?.category ?? "").trim();
    if (!c) continue;
    if (d.review_status === "rejected") { rejected.add(c); continue; }
    have.add(c);
    // A trip-history / gig earnings screenshot is income proof (t306s1653).
    if (requirementCategory(c) !== c) have.add(requirementCategory(c));
    if (d.review_status === "verified") reviewed.add(c);
  }
  // A later good upload replaces a rejected one.
  for (const c of have) rejected.delete(c);
  const missing_required = hard.filter((c) => !have.has(c));
  const missing_advisory = advisory.filter((c) => !have.has(c));
  const unreviewed = [...hard].filter((c) => have.has(c) && !reviewed.has(c) && !(c === "income" && [...reviewed].some((r) => requirementCategory(r) === "income")));
  return { have: [...have].sort(), missing_required: [...missing_required], missing_advisory: [...missing_advisory], unreviewed, rejected: [...rejected].sort() };
}

/**
 * The submitted application with the hard documents on file: what review
 * needs. The hard documents depend on gig status (hardDocCategoriesFor), so
 * `app` must carry gig_status; without it the gig-driver rule applies.
 */
export function readyForReview(app: Record<string, any>, docs: readonly FleetDoc[]): boolean {
  if (!app || app.deleted_at) return false;
  if (!(FLEET_REVIEW_STAGES as readonly string[]).includes(String(app.status ?? "").toLowerCase())) return false;
  return docPicture(docs, app).missing_required.length === 0;
}

export function assessForFleet(input: FleetReviewInput): FleetReviewAssessment {
  const { app, now } = input;
  const s = input.screening ?? {};
  const status = String(app.status ?? "").toLowerCase();
  const docs = docPicture(input.docs, app);
  const noTrackRecord = notDrivingGigYet(app);
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
  for (const c of docs.rejected) {
    const msg = `A ${c.replace(/_/g, " ")} document was rejected by staff and not replaced.`;
    // The license back is optional: a rejected one is not a blocker, but staff look at it.
    if (c === "license_back") flag(`rejected_${c}`, msg);
    else block(`rejected_${c}`, msg);
  }
  for (const d of input.disqualifiers) block("disqualifier", d);
  if (s.disqualified === true) block("screening_disqualified", `Screening marked disqualified${s.disqualification_reason ? `: ${s.disqualification_reason}` : ""}.`);
  // A flagged or declined result is never FLEET's call: blocked here and sent
  // to staff (screening_flagged). A clear result, with the gig bar met, FLEET
  // may pass (Dolmar, t299s1618).
  let screeningFlagged = false;
  for (const [k, label] of [["background_check_status", "Background check"], ["mvr_status", "Driving record (MVR)"]] as const) {
    const v = String(app[k] ?? "").trim();
    if (v && BAD_CHECK.test(v)) {
      screeningFlagged = true;
      block(`${k}_${v.toLowerCase()}`, `${label} recorded as ${v}. Staff decide flagged results; FLEET sends this to staff.`);
    }
  }
  const age = ageOn(app.dob, now);
  if (age !== null && age < T.minAge) block("under_21", `Driver is ${age} (minimum ${T.minAge}).`);
  const licDays = daysUntil(app.license_expiration, now);
  if (licDays !== null && licDays < 0) block("license_expired", "Driver's license is expired.");
  if (app.license_valid === false) block("license_invalid", "Applicant reported the license is not valid.");
  if (input.openNeedsStaff) block("open_needs_staff", `Waiting on staff: ${input.openNeedsStaff.reason}`);
  // RentID gate (switch OFF by default): both checks must be recorded as
  // passed before FLEET approves. Waiting on a check keeps the applicant in
  // FLEET's list (see `ready` below) but refuses approve.
  if (input.rentidRequired) {
    for (const [k, label] of [["background_check_status", "Criminal record (RentID)"], ["mvr_status", "License status (RentID)"]] as const) {
      const v = String(app[k] ?? "").trim();
      if (!GOOD_CHECK.test(v) && !BAD_CHECK.test(v)) block(`rentid_${k}_required`, `${label} must be recorded as passed before FLEET can approve (now: ${v || "not recorded"}).`);
    }
  }

  // ---- default escalation checklist (FLEET's call)
  // Today the call happens after approval, so a missing interview is a note.
  if (!s.interview_completed_at) note("no_interview", "Screening interview not recorded yet.");
  if (input.readinessState === "needs_attention") flag("readiness_attention", "Readiness says Needs Attention.");
  // Missing income proof is requested from the applicant (missing-documents
  // outreach), not sent to staff (Dolmar, t298s1611).
  for (const c of docs.missing_advisory) note(`requested_${c}`, `Advisory document not on file yet (requested from the applicant): ${c.replace(/_/g, " ")}.`);
  if (docs.unreviewed.length) note("docs_unreviewed", `Not yet reviewed by staff: ${docs.unreviewed.join(", ")}.`);
  if (input.licenseReading?.applied?.length) note("license_read_by_fleet", `${LICENSE_READING_LABEL} (${input.licenseReading.applied.join(", ")}); not verified, the field rep confirms the license at pickup.`);
  if (age === null) flag("no_dob", "No date of birth on file.");
  else if (age < T.youngDriverAge) flag("young_driver", `Driver is ${age}.`);
  if (licDays !== null && licDays >= 0 && licDays <= T.licenseExpiryDays) flag("license_expiring", `License expires in ${licDays} days.`);
  if (licDays === null) flag("no_license_expiry", "No license expiration date on file.");
  const flags = Array.isArray(app.ai_flags) ? app.ai_flags.filter(Boolean) : [];
  if (flags.length) flag("ai_flags", `Application analysis flags: ${flags.map(String).join("; ")}.`);
  const rating = numberOrNull(app.rating ?? s.driver_rating);
  // A rating someone does report still counts against them if it is low.
  if (rating !== null && rating > 0 && rating < T.minRating) flag("low_rating", `Gig rating ${rating} (minimum ${T.minRating.toFixed(1)}).`);
  if (noTrackRecord) {
    // Not driving for a gig app yet (Dolmar, t339u): no longer a reason to send
    // to staff by itself. The 200-trip / 4.0 minimums cannot apply to someone
    // with no trips, so they are replaced, not waived: proof of income is a
    // required document (a hard blocker above) and approve is strict, meaning
    // the server refuses it while ANY escalation exists (date of birth with
    // age 25+, license expiry known and more than 30 days out, no analysis
    // flags, no earlier declined application, checks pending or passed).
    note("no_track_record", `Not driving for a gig app yet (${app.gig_status}). Trip and rating minimums do not apply; FLEET may approve only a clean file: proof of income on file, date of birth on file and ${T.youngDriverAge}+, license expiry on file and more than ${T.licenseExpiryDays} days out, no flags, no earlier declined application, background and driving record pending or passed.`);
  } else {
    const trips = numberOrNull(app.trips_completed ?? s.trip_count);
    if (trips === null) note("no_trips", `Trip count not known; confirm ${T.minTrips}+ trips and a ${T.minRating.toFixed(1)}+ rating on the gig screenshot before approving, otherwise send to staff.`);
    else if (trips < T.minTrips) flag("few_trips", `${trips} trips completed (minimum ${T.minTrips}).`);
    if (rating === null || rating <= 0) note("no_rating", `Gig rating not known; confirm ${T.minRating.toFixed(1)}+ on the gig screenshot before approving, otherwise send to staff.`);
  }
  if (String(s.gig_account_status ?? "") === "deactivated") flag("gig_deactivated", "Gig account deactivated.");
  // "Applied before" matters only when an earlier application was declined or
  // closed (prior_declined below). Re-sending the same open application is a
  // note (Dolmar, t298s1611).
  if (Number(app.resubmission_count ?? 0) > 0) note("resubmitted", `Submitted the form ${Number(app.resubmission_count) + 1} times.`);
  if (input.priorDeclined > 0) flag("prior_declined", `${input.priorDeclined} earlier application(s) with the same phone or email were declined or closed.`);
  for (const [k, label] of [["background_check_status", "Background check"], ["mvr_status", "Driving record (MVR)"]] as const) {
    const v = String(app[k] ?? "").trim();
    // "pending" is today's default for everyone: reported as a note, never a
    // blocker or an escalation (Dolmar approved, card t310s1681). Any flag on a
    // finished check is a hard blocker (screening_flagged, D27).
    if (!v || /^pending$/i.test(v)) note(`${k}_pending`, `${label}: ${v || "not recorded"}.`);
    else if (!BAD_CHECK.test(v) && !GOOD_CHECK.test(v)) flag(`${k}_open`, `${label}: ${v}.`);
  }
  if (s.has_personal_insurance === true && s.insurance_name_matches_license === false) flag("insurance_name", "Insurance name does not match the license.");

  // Blockers that do not hide the applicant from FLEET's list: an open staff
  // flag (filtered separately) and a RentID result still to come.
  const waiting = (code: string) => code === "open_needs_staff" || /^rentid_.*_required$/.test(code);
  const ready = blockers.every((b) => waiting(b.code));
  return {
    submitted,
    docs,
    hard_blockers: blockers,
    escalations: esc,
    notes,
    recommendation: screeningFlagged ? "needs_staff" : blockers.length ? "not_ready" : esc.length ? "needs_staff" : "approve",
    screening_flagged: screeningFlagged,
    ready_for_review: ready && readyForReview(app, input.docs),
    no_track_record: noTrackRecord,
    required_documents: [...hardDocCategoriesFor(app)],
  };
}
