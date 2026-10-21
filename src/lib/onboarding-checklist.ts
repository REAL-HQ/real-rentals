/**
 * Dark onboarding checklist for approved, active, and closed drivers.
 *
 * The facts themselves live in driver-readiness-facts.ts. This file is only
 * the gate and the shape of the cohort answer. ONBOARDING_CHECKLIST_ENABLED
 * is the only declaration of the gate. Nothing reads an environment variable
 * to open it.
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

export type OnboardingFactState = "done" | "missing" | "unknown";

export type OnboardingStep = {
  key: string;
  label: string;
  state: OnboardingFactState;
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
  failed: boolean;
  truncated: boolean;
  cap: number;
  drivers: OnboardingDriver[];
};
