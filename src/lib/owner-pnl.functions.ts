import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { OWNER_PNL_ENABLED } from "./owner-pnl-flag";
import type { OwnerPnlResponse } from "./owner-pnl.server";

/**
 * Owner-only monthly P&L. While OWNER_PNL_ENABLED is false this returns
 * before the owner check and before any table or Stripe read.
 * Charges are listed by readLivePartnerCharges. Fees are listed by
 * readLiveOwnerPnlFees after the owner check. No writes, no new SQL, no email.
 */

const DISABLED: OwnerPnlResponse = { status: "disabled", report: null };

export const getOwnerPnl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<OwnerPnlResponse> => {
    if (!OWNER_PNL_ENABLED) return DISABLED;
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOwnerPnlDirectory, runOwnerPnl } = await import("./owner-pnl.server");
    const { readLivePartnerCharges } = await import("./partner-statement-read.server");
    const { readLiveOwnerPnlFees } = await import("./owner-pnl-fees-read.server");
    return runOwnerPnl({
      enabled: true,
      userId: context.userId,
      tier: "owner",
      month: data.month,
      load: () => loadOwnerPnlDirectory(supabaseAdmin),
      readCharges: (window) => readLivePartnerCharges(window),
      readFees: (window) => readLiveOwnerPnlFees(window),
    });
  });
