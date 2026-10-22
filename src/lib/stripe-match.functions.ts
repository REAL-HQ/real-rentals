import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readLiveStripeMatch } from "./stripe-match-read.server";
import { loadMatchDirectory, runStripeMatch, type StripeMatchResponse } from "./stripe-match.server";

/** Read-only. The flag is enforced inside runStripeMatch before Stripe or the directory is touched. */
export const getStripeMatchReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StripeMatchResponse> => {
    if (!context.userId) throw new Error("Forbidden");
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    return runStripeMatch({
      userId: context.userId,
      roles: roles.map((row) => row.role),
      env: process.env,
      loadDirectory: () => loadMatchDirectory(context.supabase),
      readStripe: () => readLiveStripeMatch(),
    });
  });
