import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { REFUND_RETURNS_DUE_ENABLED, REFUND_RETURNS_DUE_OFF } from "./refund-returns-due-flag";
import type { RefundReturnsClient, RefundReturnsResponse } from "./refund-returns-due.server";
import { etToday } from "./refund-returns-due";

/** Read-only. While the flag is off this throws before the manager check and before any deposit or Stripe read. */
export const getRefundReturnsDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RefundReturnsResponse> => {
    if (!REFUND_RETURNS_DUE_ENABLED) throw new Error(REFUND_RETURNS_DUE_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadRefundReturns, runRefundReturns } = await import("./refund-returns-due.server");
    const { readLiveRefundReturnsStripe } = await import("./refund-returns-due-stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runRefundReturns({
      enabled: REFUND_RETURNS_DUE_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      today: etToday(),
      load: () => loadRefundReturns(supabaseAdmin as unknown as RefundReturnsClient),
      stripe: (payments) => readLiveRefundReturnsStripe(payments),
    });
  });
