import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STRIPE_PAYOUT_RECON_ENABLED, STRIPE_PAYOUT_RECON_OFF } from "./stripe-payout-recon-flag";
import type { PayoutReconClient, PayoutReconResponse } from "./stripe-payout-recon.server";

/** Read-only. While the flag is off this throws before the manager check and before any payment or Stripe read. */
export const getStripePayoutRecon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ context }): Promise<PayoutReconResponse> => {
    if (!STRIPE_PAYOUT_RECON_ENABLED) throw new Error(STRIPE_PAYOUT_RECON_OFF);
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
