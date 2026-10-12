/**
 * What the Overview dashboard and the notification bell may see of an
 * applications row.
 *
 * Both screens read `applications` straight from the browser today. Security
 * migration 0030 (`coordinator_identity_access`) revokes the blanket
 * `SELECT ON public.applications` from `authenticated` and re-grants only an
 * allow-listed set of columns. Three things follow, and this module exists
 * for all three:
 *
 *  1. `deleted_at` is NOT in that allow-list, and every one of these queries
 *     filters on it. PostgREST needs SELECT on a filter column, so the whole
 *     query fails — for an Owner and a Manager too, because a column grant is
 *     not a role policy.
 *  2. The readiness inputs the dashboard pulls (`license_photo_url`,
 *     `insurance_doc_url`, `profile_screenshot_url`, `trip_screenshots`) are
 *     deliberately outside the allow-list. They are identity documents.
 *  3. Those same four columns are being handed to a Coordinator's browser
 *     right now, which is the Drivers-list leak PR #28 closed, still open on
 *     this screen.
 *
 * So the reads move to the server, exactly as the Drivers list did, and what
 * crosses the wire is decided there. The dashboard never needed the identity
 * columns: it needs a readiness VERDICT. So the verdict is computed on the
 * server and the inputs stay there — for every tier, not only Coordinators.
 *
 * This file is the field policy, kept pure and client-safe so the panel and
 * the server function cannot disagree about it. It is not a second applicant
 * record: the row is the same applications row, read once, projected down.
 */

import type { ReadinessResult } from "@/lib/readiness";

/**
 * How many applicants the dashboard derives readiness from.
 *
 * Readiness is computed on read, never stored, so the rows have to come back.
 * Bounded rather than unbounded; at the current pipeline size this is every
 * applicant several times over.
 */
export const APPLICANT_WINDOW = 500;

/**
 * The applicant fields the Overview list actually renders.
 *
 * Name, lifecycle, wizard progress and two timestamps. That is the whole of
 * it — the readiness pill is driven by the computed verdict, not by these.
 */
export const OVERVIEW_APPLICANT_FIELDS = [
  "id",
  "full_name",
  "status",
  "current_step",
  "created_at",
  "reviewed_at",
] as const;

/**
 * The applicant fields the notification bell renders.
 *
 * It is a "somebody new applied, here is how to reach them" list, so it
 * carries the contact details and nothing else. Email and phone are
 * operational for every staff tier — the same two fields the Drivers list
 * already shows a Coordinator.
 */
export const NOTIFICATION_FIELDS = [
  "id",
  "full_name",
  "email",
  "phone",
  "created_at",
  "status",
] as const;

/**
 * Fields that must NEVER leave the server through either of these reads.
 *
 * Not the inverse of the allow-lists — those already decide what goes out.
 * This is the named set the tests assert on, so "we trimmed the projection"
 * and "this specific identity field is gone" stay two independently checked
 * statements. The first four are the readiness inputs: they are the reason
 * the verdict is computed server-side rather than shipped as raw data.
 */
export const OVERVIEW_WITHHELD_FIELDS = [
  "license_photo_url",
  "insurance_doc_url",
  "profile_screenshot_url",
  "trip_screenshots",
  "license_number",
  "license_state",
  "license_expiration",
  "license_valid",
  "dob",
  "address",
  "zip",
  "city",
  "insurance_carrier",
  "insurance_policy_number",
  "card_brand",
  "card_last4",
  "card_exp_month",
  "card_exp_year",
  "stripe_customer_id",
  "stripe_payment_method_id",
  "deposit_amount",
  "deposit_paid",
  "weekly_rent",
  "notes",
  "ai_summary",
  "ai_flags",
  "ai_score",
  "score",
  "user_id",
  "requested_docs",
  "resubmission_history",
  "platforms",
  "trips_completed",
  "rating",
  "years_licensed",
  "gig_status",
  "insurance_answer",
  "full_coverage_insurance",
  "insurance_rideshare_endorsement",
  "pickup_date",
  "start_timing",
  "drive_type",
] as const;

/** Column list for the Overview applicant read. */
export const OVERVIEW_APPLICANT_SELECT = OVERVIEW_APPLICANT_FIELDS.join(",");
/** Column list for the notification read. */
export const NOTIFICATION_SELECT = NOTIFICATION_FIELDS.join(",");

export type OverviewApplicantRow = {
  id: string;
  full_name: string | null;
  status: string | null;
  current_step: string | null;
  created_at: string | null;
  reviewed_at: string | null;
};

export type NotificationRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string | null;
  status: string | null;
};

/** A row as it arrives from the database, before projection. */
export type RawRow = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Cut a database row down to the Overview display fields.
 *
 * Returns null for a row with no id rather than inventing one: a readiness
 * verdict is keyed by id, and a row that cannot be keyed cannot be rendered.
 */
export function projectOverviewApplicant(row: RawRow): OverviewApplicantRow | null {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    full_name: str(row.full_name),
    status: str(row.status),
    current_step: str(row.current_step),
    created_at: str(row.created_at),
    reviewed_at: str(row.reviewed_at),
  };
}

/** Cut a database row down to the notification fields. */
export function projectNotification(row: RawRow): NotificationRow | null {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    full_name: str(row.full_name),
    email: str(row.email),
    phone: str(row.phone),
    created_at: str(row.created_at),
    status: str(row.status),
  };
}

/** True when a projected row carries nothing from the withheld set. */
export function isOverviewSafe(row: object): boolean {
  return !OVERVIEW_WITHHELD_FIELDS.some((f) =>
    Object.prototype.hasOwnProperty.call(row, f as string),
  );
}

/**
 * Readiness verdicts by applicant id.
 *
 * A Record rather than the module's own Map, because this crosses the
 * server-function boundary and a Map does not survive serialisation.
 * Empty for a Coordinator — see `canSeeReadiness`.
 */
export type ReadinessByApplicant = Record<string, ReadinessResult>;

export type OverviewApplicantsResult = {
  /** Finished the wizard and nobody has opened it yet. */
  newApps: number;
  /** Still mid-wizard. */
  pendingApps: number;
  applicants: OverviewApplicantRow[];
  readiness: ReadinessByApplicant;
  /**
   * False for a Coordinator. Readiness is derived from licence, insurance,
   * document and screening data a Coordinator is not sent — the same reason
   * the Drivers list shows them "Manager Only" rather than a score. The
   * verdict would be a summary of exactly the evidence they may not see, so
   * it is withheld whole and the Hot Prospect strip is withheld with it.
   */
  canSeeReadiness: boolean;
};

export type NotificationsResult = { rows: NotificationRow[] };
