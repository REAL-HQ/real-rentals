import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { tierAllows, tierFromRoles } from "./roles";
import { STRIPE_PAYOUT_MATCH_ENABLED } from "./stripe-payout-match-flag";
import type { PayoutMatchReport, PayoutRow } from "./stripe-payout-match.server";

export type PayoutMatchResponse =
  | { status: "disabled"; payouts: []; unmatched: []; paidNotInPayout: []; truncated: false }
  | PayoutMatchReport;

/**
 * Runs before requireSupabaseAuth. Returning `result` does not call next(),
 * so a hard-off flag never reads the bearer token, the database, or Stripe.
 */
const gatePayoutMatch = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!STRIPE_PAYOUT_MATCH_ENABLED) {
    return { result: { status: "disabled", payouts: [], unmatched: [], paidNotInPayout: [], truncated: false } } as any;
  }
  return next();
});

export const getStripePayoutMatch = createServerFn({ method: "POST" })
  .middleware([gatePayoutMatch, requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data ?? {}))
  .handler(async ({ context }): Promise<PayoutMatchResponse> => {
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles || !tierAllows(tierFromRoles(roles.map((row: { role: string }) => row.role)), "manager")) {
      throw new Error("Forbidden");
    }
    const { loadPayoutMatch } = await import("./stripe-payout-match.server");
    const { createReadOnlyStripe } = await import("./stripe-reader.server");
    return loadPayoutMatch(context.supabase, createReadOnlyStripe("live", { cache: true }));
  });

export type { PayoutRow };
