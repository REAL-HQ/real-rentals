import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FINANCE_JV_STATEMENT_ENABLED } from "./jv-statement-flag";
import type { JvStatementResponse } from "./jv-statement";

/**
 * Owner-only partner statement. While FINANCE_JV_STATEMENT_ENABLED is false
 * this returns before the owner check and before any table or Stripe read.
 * The handler never writes.
 */

const DISABLED: JvStatementResponse = { status: "disabled", vehicles: [], statement: null };

export const getJvStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid().optional(),
        period: z.enum(["this_month", "last_month", "last_90"]).default("this_month"),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<JvStatementResponse> => {
    if (!FINANCE_JV_STATEMENT_ENABLED) return DISABLED;
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadJvDirectory, runJvStatement } = await import("./jv-statement.server");
    const { readLiveJvCharges } = await import("./jv-statement-read.server");
    return runJvStatement({
      enabled: true,
      userId: context.userId,
      tier: "owner",
      vehicleId: data.vehicleId ?? null,
      period: data.period,
      load: () => loadJvDirectory(supabaseAdmin),
      readCharges: (window) => readLiveJvCharges(window),
    });
  });
