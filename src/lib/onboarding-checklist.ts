/**
 * Dark onboarding checklist for drivers who have been approved.
 *
 * The drivers drawer already has a Rental Readiness card. That card is a
 * set of booleans on the open record. This module is the cohort view of the
 * same job: for each
 * approved, active, or closed driver, seven facts with the record they came
 * from and the time on that record. It does not invent a time when the
 * column does not have one.
 *
 * ONBOARDING_CHECKLIST_ENABLED is the only declaration of the gate. Nothing
 * reads an environment variable to open it.
 */
export const ONBOARDING_CHECKLIST_ENABLED: boolean = false;

export const ONBOARDING_ROW_CAP = 1000;

export const ONBOARDING_STATUSES = ["approved", "active", "closed"] as const;

export function onboardingCohort(status: string): boolean {
  return (ONBOARDING_STATUSES as readonly string[]).includes(status);
}

export function assertOnboardingChecklistEnabled(): void {
  if (ONBOARDING_CHECKLIST_ENABLED !== true) {
    throw new Error("Onboarding checklist is disabled.");
  }
}

/** True while the checklist stays off. The handler stops before any read. */
export const ONBOARDING_CHECKLIST_REFUSED: boolean = !ONBOARDING_CHECKLIST_ENABLED;

export const ONBOARDING_STEP_KEYS = [
  "license_docs",
  "id",
  "agreement",
  "card",
  "deposit",
  "pickup",
  "vehicle",
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export type OnboardingStep = {
  key: OnboardingStepKey;
  label: string;
  done: boolean;
  source: string | null;
  at: string | null;
};

export type OnboardingDriver = {
  id: string;
  name: string;
  status: string;
  steps: OnboardingStep[];
  nextMissingStep: string;
};

export type OnboardingChecklistResult = {
  truncated: boolean;
  cap: number;
  drivers: OnboardingDriver[];
};

export type OnboardingApplication = {
  id: string;
  full_name: string | null;
  status: string;
  deleted_at: string | null;
  card_last4: string | null;
  stripe_payment_method_id: string | null;
  card_on_file_at: string | null;
  background_check_status: string | null;
  pickup_date: string | null;
  vehicle_id: string | null;
  deposit_status: string | null;
};

export type OnboardingDocument = {
  driver_id: string | null;
  category: string | null;
  review_status: string | null;
  reviewed_at: string | null;
  is_current: boolean | null;
  source: string | null;
};

export type OnboardingIdentityReview = {
  application_id: string | null;
  status: string | null;
  resolution: string | null;
  resolved_at: string | null;
  source: string | null;
};

export type OnboardingAgreement = {
  application_id: string | null;
  status: string | null;
  signed_at: string | null;
  voided_at: string | null;
  source: string | null;
};

export type OnboardingPayment = {
  driver_id: string | null;
  type: string | null;
  status: string | null;
  net_collected: number | string | null;
  amount: number | string | null;
  refunded_amount: number | string | null;
  paid_date: string | null;
};

export type OnboardingRental = {
  application_id: string | null;
  vehicle_id: string | null;
  created_at: string | null;
  start_date: string | null;
  deposit_held: boolean | null;
  deposit_status: string | null;
  deposit_settled_at: string | null;
  card_last4: string | null;
  stripe_payment_method_id: string | null;
  card_on_file_at: string | null;
};

export type OnboardingChecklistInput = {
  applications: readonly OnboardingApplication[];
  documents: readonly OnboardingDocument[];
  reviews: readonly OnboardingIdentityReview[];
  agreements: readonly OnboardingAgreement[];
  payments: readonly OnboardingPayment[];
  rentals: readonly OnboardingRental[];
  truncated: boolean;
};

