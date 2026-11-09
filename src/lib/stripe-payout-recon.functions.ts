import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STRIPE_PAYOUT_RECON_ENABLED } from "./stripe-payout-recon-flag";
import type { PayoutReconClient, PayoutReconResponse } from "./stripe-payout-recon.server";

/**
 * Runs before requireSupabaseAuth. Returning `result` does not call next(),
 * so a hard-off flag never reads the bearer token, the database, or Stripe.
 */
export const gateStripePayoutRecon = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!STRIPE_PAYOUT_RECON_ENABLED) {
    return { result: { status: "disabled" } } as any;
  }
  return next();
});

/** Read-only. While the flag is off the gate returns before auth and before any payment or Stripe read. */
export const getStripePayoutRecon = createServerFn({ method: "POST" })
  .middleware([gateStripePayoutRecon, requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ context }): Promise<PayoutReconResponse> => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadPayoutReconDirectory, runPayoutRecon } = await import("./stripe-payout-recon.server");
    const { readLivePayoutRecon } = await import("./stripe-payout-recon-read.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runPayoutRecon({
      enabled: STRIPE_PAYOUT_RECON_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      now: new Date(),
      load: () => loadPayoutReconDirectory(supabaseAdmin as unknown as PayoutReconClient),
      readStripe: (window) => readLivePayoutRecon(window),
    });
  });
