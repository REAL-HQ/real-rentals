import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { tierAllows, tierFromRoles } from "@/lib/roles";
import { STRIPE_UNMATCHED_LINK_ENABLED } from "@/lib/stripe-unmatched-link-flag";
import type { LinkResult } from "@/lib/stripe-unmatched-link.server";

export type LinkResponse = { status: "disabled" } | LinkResult;

export const linkUnmatchedInvoiceInput = z.object({
  invoiceId: z.string().regex(/^in_[A-Za-z0-9]+$/),
  rentalId: z.string().uuid(),
}).strict();

/**
 * Runs before requireSupabaseAuth. Returning `result` does not call next(),
 * so a hard-off flag never reads the bearer token, the database, or Stripe.
 */
export const gateUnmatchedLink = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!STRIPE_UNMATCHED_LINK_ENABLED) {
    return { result: { status: "disabled" } } as any;
  }
  return next();
});

/** Owner or Manager. The client supplies an invoice id and a rental id only. */
export const linkUnmatchedInvoice = createServerFn({ method: "POST" })
  .middleware([gateUnmatchedLink, requireSupabaseAuth])
  .inputValidator((data: unknown) => linkUnmatchedInvoiceInput.parse(data))
  .handler(async ({ data, context }): Promise<LinkResponse> => {
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles || !tierAllows(tierFromRoles(roles.map((row: { role: string }) => row.role)), "manager")) {
      throw new Error("Forbidden");
    }
    const { runUnmatchedLink } = await import("@/lib/stripe-unmatched-link.server");
    const { createReadOnlyStripe } = await import("@/lib/stripe-reader.server");
    return runUnmatchedLink({
      enabled: STRIPE_UNMATCHED_LINK_ENABLED,
      supabase: context.supabase,
      stripe: createReadOnlyStripe("live"),
      userId: context.userId,
      invoiceId: data.invoiceId,
      rentalId: data.rentalId,
    });
  });
