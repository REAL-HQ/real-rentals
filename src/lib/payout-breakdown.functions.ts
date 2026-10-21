import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PAYOUT_BREAKDOWN_ENABLED } from "./payout-breakdown-flag";
import type { PayoutBreakdownResponse } from "./payout-breakdown.server";

/**
 * Owner-only payout breakdown. While PAYOUT_BREAKDOWN_ENABLED is false this
 * returns before the owner check and before any Stripe or table read.
 * Stripe is one cached read-only client. No writes, no new SQL, no email.
 */

const DISABLED: PayoutBreakdownResponse = { status: "disabled", report: null };
const range = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const getPayoutBreakdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(async ({ data, context }): Promise<PayoutBreakdownResponse> => {
    if (!PAYOUT_BREAKDOWN_ENABLED) return DISABLED;
    const dates = range.parse(data ?? {});
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { runPayoutBreakdown, loadPayoutDirectory } = await import("./payout-breakdown.server");
    const { readLivePayoutBreakdown } = await import("./payout-breakdown-read.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runPayoutBreakdown({
      enabled: true,
      userId: context.userId,
      tier: "owner",
      from: dates.from,
      through: dates.through,
      loadDirectory: () => loadPayoutDirectory(supabaseAdmin),
      readStripe: (window) => readLivePayoutBreakdown(window),
    });
  });
