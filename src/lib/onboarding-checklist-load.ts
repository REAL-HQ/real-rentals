import { COUNTED_ID_BATCH, readCounted, readInIdBatches } from "./count-paged-read";
import { ONBOARDING_ROW_CAP, ONBOARDING_STATUSES, type OnboardingChecklistResult } from "./onboarding-checklist";
import { buildOnboardingChecklist } from "./onboarding-checklist-build";
import type { ReadinessAgreement } from "./driver-readiness-facts";
import type { ReadinessApplication } from "./driver-readiness-facts";
import type { ReadinessDocument } from "./driver-readiness-facts";
import type { ReadinessPayment } from "./driver-readiness-facts";
import type { ReadinessRental } from "./driver-readiness-facts";
import type { ReadinessScreening } from "./driver-readiness-facts";

const failed = (): OnboardingChecklistResult => ({
  failed: true,
  truncated: false,
  cap: ONBOARDING_ROW_CAP,
  drivers: [],
});

const APPLICATION_COLUMNS =
  "id,full_name,status,deleted_at,card_last4,stripe_payment_method_id,card_on_file_at,deposit_status,license_expiration,insurance_expires_on";

/**
 * The cohort read. Callers have already passed the flag and the role check.
 * An error is `failed`, not a cap. A count above the cap still returns the
 * drivers that were read.
 */
export async function loadOnboardingChecklist(admin: {
  from: (table: string) => any;
}): Promise<OnboardingChecklistResult> {
  const applications = await readCounted(
    (from, to) =>
      admin
        .from("applications")
        .select(APPLICATION_COLUMNS, { count: "exact" })
        .is("deleted_at", null)
        .in("status", [...ONBOARDING_STATUSES])
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ONBOARDING_ROW_CAP,
  );
  if (!applications.ok) return failed();
  const ids = applications.rows.map((row) => String(row.id));
  const documents = await readInIdBatches(ids, (chunk, from, to) =>
    admin
      .from("documents")
      // No category list. canonicalRequiredDoc trims and maps vault names,
      // and an exact category match would hide a row that rule still counts.
      // Superseded rows stay out because is_current is false. A rejected
      // current row is selected, and review_status keeps it from counting.
      .select("id,driver_id,category,is_current,review_status,reviewed_at,created_at", { count: "exact" })
      .in("driver_id", chunk)
      .eq("is_current", true)
      .order("id", { ascending: true })
      .range(from, to),
    COUNTED_ID_BATCH,
  );
  if (!documents.ok) return failed();
  const screenings = await readInIdBatches(ids, (chunk, from, to) =>
    admin
      .from("driver_screenings")
      .select("id,lead_id,interview_completed_at,insurance_verified,insurance_verified_at,mvr_authorized", { count: "exact" })
      .in("lead_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
    COUNTED_ID_BATCH,
  );
  if (!screenings.ok) return failed();
  const agreements = await readInIdBatches(ids, (chunk, from, to) =>
    admin
      .from("agreements")
      .select("id,application_id,status,signed_at,voided_at", { count: "exact" })
      .in("application_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
    COUNTED_ID_BATCH,
  );
  if (!agreements.ok) return failed();
  const payments = await readInIdBatches(ids, (chunk, from, to) =>
    admin
      .from("payments")
      .select("id,driver_id,type,status,net_collected,amount,paid_date", { count: "exact" })
      .in("driver_id", chunk)
      .eq("type", "deposit")
      .order("id", { ascending: true })
      .range(from, to),
    COUNTED_ID_BATCH,
  );
  if (!payments.ok) return failed();
  const rentals = await readInIdBatches(ids, (chunk, from, to) =>
    admin
      .from("rentals")
      .select(
        "id,application_id,status,start_date,card_last4,stripe_payment_method_id,card_on_file_at,deposit_held,deposit_status,deposit_settled_at",
        { count: "exact" },
      )
      .in("application_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
    COUNTED_ID_BATCH,
  );
  if (!rentals.ok) return failed();
  return buildOnboardingChecklist({
    applications: applications.rows as unknown as ReadinessApplication[],
    documents: documents.rows as unknown as ReadinessDocument[],
    screenings: screenings.rows as unknown as ReadinessScreening[],
    agreements: agreements.rows as unknown as ReadinessAgreement[],
    payments: payments.rows as unknown as ReadinessPayment[],
    rentals: rentals.rows as unknown as ReadinessRental[],
    truncated: applications.truncated,
  });
}
