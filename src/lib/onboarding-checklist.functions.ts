import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ONBOARDING_CHECKLIST_REFUSED,
  ONBOARDING_ROW_CAP,
  assertOnboardingChecklistEnabled,
  type OnboardingChecklistResult,
} from "./onboarding-checklist";

const onboardingChecklistGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertOnboardingChecklistEnabled();
  return next();
});

const idle = (): OnboardingChecklistResult => ({
  failed: false,
  truncated: false,
  cap: ONBOARDING_ROW_CAP,
  drivers: [],
});

export const getOnboardingChecklist = createServerFn({ method: "GET" })
  .middleware([onboardingChecklistGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingChecklistResult> => {
    if (ONBOARDING_CHECKLIST_REFUSED) {
      assertOnboardingChecklistEnabled();
      return idle();
    }
    const { loadOnboardingChecklist } = await import("./onboarding-checklist-load");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadOnboardingChecklist(supabaseAdmin);
  });
