import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PARTNER_STATEMENT_ENABLED } from "./partner-statement-flag";
import type { PartnerStatementResponse } from "./partner-statement";

/**
 * Owner-only partner statement. While PARTNER_STATEMENT_ENABLED is false this
 * returns before the owner check and before any table or Stripe read.
 * The handler never writes, never sends email, and never runs SQL of its own.
 */

const DISABLED: PartnerStatementResponse = { status: "disabled", partners: [], statement: null };

export const getPartnerStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      partnerId: z.string().trim().min(1).max(80).optional(),
      period: z.enum(["this_month", "last_month", "last_90"]).default("this_month"),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<PartnerStatementResponse> => {
    if (!PARTNER_STATEMENT_ENABLED) return DISABLED;
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadPartnerStatementDirectory, runPartnerStatement } = await import("./partner-statement.server");
    const { readLivePartnerCharges } = await import("./partner-statement-read.server");
    return runPartnerStatement({
      enabled: true,
      userId: context.userId,
      tier: "owner",
      partnerId: data.partnerId ?? null,
      period: data.period,
      load: () => loadPartnerStatementDirectory(supabaseAdmin),
      readCharges: (window) => readLivePartnerCharges(window),
    });
  });
