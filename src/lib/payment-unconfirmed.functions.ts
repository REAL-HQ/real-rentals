import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Owner only: release a Processing charge whose outcome Stripe never confirmed, after checking
// every configured Stripe account (payment-unconfirmed.server.ts). Audited.
export const releaseUnconfirmedPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        paymentId: z.string().uuid(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; checked: number } | { error: string }> => {
    const { requireOwner } = await import("@/lib/roles.server");
    let actor;
    try {
      actor = await requireOwner(context.userId);
    } catch {
      return { error: "Only the Owner can release an unconfirmed charge." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createStripeClient } = await import("@/lib/stripe.server");
    const { releaseUnconfirmedCharge } = await import("@/lib/payment-unconfirmed.server");
    // Not chosen by the browser: every account with keys configured is checked. One without
    // keys cannot have taken the charge either.
    const accounts = [];
    for (const env of ["live", "sandbox"] as const) {
      try {
        accounts.push({ env, stripe: createStripeClient(env) });
      } catch {
        // not configured
      }
    }
    return releaseUnconfirmedCharge(supabaseAdmin, accounts, {
      paymentId: data.paymentId,
      reason: data.reason,
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
    });
  });
