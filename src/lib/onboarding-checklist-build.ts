import {
  ONBOARDING_ROW_CAP,
  onboardingCohort,
  type OnboardingChecklistResult,
  type OnboardingDriver,
} from "./onboarding-checklist";
import {
  driverDisplayName,
  nextMissingFact,
  readinessFacts,
  type ReadinessAgreement,
  type ReadinessApplication,
  type ReadinessDocument,
  type ReadinessPayment,
  type ReadinessRental,
  type ReadinessScreening,
} from "./driver-readiness-facts";

export type OnboardingChecklistData = {
  applications: readonly ReadinessApplication[];
  documents: readonly ReadinessDocument[];
  screenings: readonly ReadinessScreening[];
  agreements: readonly ReadinessAgreement[];
  payments: readonly ReadinessPayment[];
  rentals: readonly ReadinessRental[];
  truncated: boolean;
};

function forDriver<T extends { driver_id?: string | null; lead_id?: string | null; application_id?: string | null }>(
  rows: readonly T[],
  id: string,
  field: "driver_id" | "lead_id" | "application_id",
): T[] {
  return rows.filter((row) => row[field] === id);
}

export function buildOnboardingChecklist(input: OnboardingChecklistData): OnboardingChecklistResult {
  const drivers: OnboardingDriver[] = [];
  for (const app of input.applications) {
    if (app.deleted_at || app.status === "duplicate" || !onboardingCohort(app.status)) continue;
    const screening = input.screenings.find((row) => row.lead_id === app.id) ?? null;
    const steps = readinessFacts({
      application: app,
      documents: forDriver(input.documents, app.id, "driver_id"),
      screening,
      agreements: forDriver(input.agreements, app.id, "application_id"),
      payments: forDriver(input.payments, app.id, "driver_id"),
      rentals: forDriver(input.rentals, app.id, "application_id"),
    });
    drivers.push({
      id: app.id,
      name: driverDisplayName(app.full_name),
      status: app.status,
      steps,
      nextMissingStep: nextMissingFact(steps),
    });
  }
  return { failed: false, truncated: input.truncated, cap: ONBOARDING_ROW_CAP, drivers };
}
