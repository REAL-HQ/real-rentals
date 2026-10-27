import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { tierAllows, tierFromRoles } from "./roles";
import { STRIPE_UNMATCHED_PAYMENTS_ENABLED } from "./stripe-unmatched-flag";
import type { UnmatchedReport, UnmatchedRow } from "./stripe-unmatched.server";

export type UnmatchedResponse =
  | { status: "disabled"; rows: []; truncated: false }
  | UnmatchedReport;

/**
 * Runs before requireSupabaseAuth. Returning `result` does not call next(),
 * so a hard-off flag never reads the bearer token, the database, or Stripe.
 */
const gateUnmatchedPayments = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!STRIPE_UNMATCHED_PAYMENTS_ENABLED) {
    return { result: { status: "disabled", rows: [], truncated: false } } as any;
  }
  return next();
});

export const getUnmatchedStripePayments = createServerFn({ method: "POST" })
  .middleware([gateUnmatchedPayments, requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data ?? {}))
  .handler(async ({ context }): Promise<UnmatchedResponse> => {
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles || !tierAllows(tierFromRoles(roles.map((row: { role: string }) => row.role)), "manager")) {
      throw new Error("Forbidden");
    }
    const { loadUnmatchedStripePayments } = await import("./stripe-unmatched.server");
    const { createReadOnlyStripe } = await import("./stripe-reader.server");
    return loadUnmatchedStripePayments(context.supabase, createReadOnlyStripe("live", { cache: true }));
  });

export type { UnmatchedRow };
