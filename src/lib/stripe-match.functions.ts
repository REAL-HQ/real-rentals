import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STRIPE_MATCH_REPORT_ENABLED } from "./stripe-match-flag";
import { readLiveStripeMatch } from "./stripe-match-read.server";
import { loadMatchDirectory, runStripeMatch, type StripeMatchResponse } from "./stripe-match.server";

/** Read-only. The flag returns disabled before the role check, the directory, and Stripe. */
export const getStripeMatchReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StripeMatchResponse> => {
    if (!STRIPE_MATCH_REPORT_ENABLED) return { status: "disabled", report: null };
    if (!context.userId) throw new Error("Forbidden");
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    return runStripeMatch({
      userId: context.userId,
      roles: roles.map((row) => row.role),
      enabled: STRIPE_MATCH_REPORT_ENABLED,
      loadDirectory: () => loadMatchDirectory(context.supabase),
      readStripe: () => readLiveStripeMatch(),
    });
  });
