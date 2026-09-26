// Readiness for a whole list, in three queries.
//
// Readiness is computed on read, never stored, so it is always current: upload
// a document or finish an interview and the number moves on the next render,
// with no column to backfill and no cache to invalidate. The cost of that
// decision is that a list of applicants needs their screenings and documents
// too, and the obvious way to get those — one query per row — is how dashboards
// die at a thousand rows.
//
// So nothing here fetches. The caller does three `in(...)` queries and hands
// the rows over; this builds the lookup and computes. That keeps the query
// count flat regardless of list length, and keeps the module pure enough to
// run in a test without a database.

import {
  computeReadiness,
  type ReadinessDocument,
  type ReadinessInput,
  type ReadinessResult,
} from "@/lib/readiness";

export type ReadinessIndex = Map<string, ReadinessResult>;

type Keyed = { lead_id?: string | null };

/** Group rows by the applicant they belong to. */
function byLead<T extends Keyed>(rows: readonly T[] | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows ?? []) {
    const id = r?.lead_id;
    if (!id) continue;
    const list = out.get(id);
    if (list) list.push(r);
    else out.set(id, [r]);
  }
  return out;
}

/**
 * Readiness for every application in one pass.
 *
 * `screenings` and `documents` are the full result sets for these applicants —
 * fetched with `.in("lead_id", ids)`, not per row. Missing screenings and
 * missing documents are normal and mean unknown, never bad.
 */
export function buildReadinessIndex(
  applications: readonly (ReadinessInput & { id?: string | null })[],
  screenings: readonly (ReadinessInput & Keyed)[] | null | undefined,
  documents: readonly (ReadinessDocument & Keyed)[] | null | undefined,
): ReadinessIndex {
  const screeningByLead = byLead(screenings);
  const docsByLead = byLead(documents);
  const index: ReadinessIndex = new Map();
  for (const app of applications) {
    const id = app?.id;
    if (!id) continue;
    index.set(
      id,
      computeReadiness(app, screeningByLead.get(id)?.[0] ?? null, docsByLead.get(id) ?? []),
    );
  }
  return index;
}

/** The columns `buildReadinessIndex` reads off an application row. */
export const READINESS_APPLICATION_COLUMNS = [
  "id",
  "platforms",
  "trips_completed",
  "rating",
  "start_timing",
  "license_valid",
  "license_photo_url",
  "years_licensed",
  "full_coverage_insurance",
  "insurance_doc_url",
  "insurance_rideshare_endorsement",
  "profile_screenshot_url",
  "trip_screenshots",
  "gig_status",
] as const;

/** The columns it reads off a screening row. */
export const READINESS_SCREENING_COLUMNS = [
  "lead_id",
  "gig_account_status",
  "months_on_platform",
  "trip_count",
  "driver_rating",
  "drive_type",
  "license_active",
  "license_years",
  "driver_age",
  "has_personal_insurance",
  "policy_active",
  "insurance_name_matches_license",
  "rideshare_endorsement",
  "accidents_last_3yr",
  "has_dui",
  "major_violations",
  "license_points",
  "insurance_verified",
  "card_in_own_name",
  "rate_confirmed",
  "needed_by_date",
] as const;

/** Ready to drop into `.select(...)`. */
export const READINESS_APPLICATION_SELECT = READINESS_APPLICATION_COLUMNS.join(",");
export const READINESS_SCREENING_SELECT = READINESS_SCREENING_COLUMNS.join(",");
export const READINESS_DOCUMENT_SELECT = "lead_id,doc_type";
