import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FINANCE_MONTHLY_PL_ENABLED, MONTHLY_PL_OFF } from "./finance-monthly-pl-flag";
import type { MonthlyPlClient, MonthlyPlResponse } from "./finance-monthly-pl.server";

/** Read-only. The flag throws before the role check and before any table read. */
export const getFinanceMonthlyPl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ context, data }): Promise<MonthlyPlResponse> => {
    if (!FINANCE_MONTHLY_PL_ENABLED) throw new Error(MONTHLY_PL_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadMonthlyPlDirectory, runMonthlyPl } = await import("./finance-monthly-pl.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runMonthlyPl({
      enabled: FINANCE_MONTHLY_PL_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      month: requestedMonth(data),
      asOf: new Date(),
      load: () => loadMonthlyPlDirectory(supabaseAdmin as unknown as MonthlyPlClient),
    });
  });

function requestedMonth(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null;
  const month = (data as { month?: unknown }).month;
  if (typeof month !== "string") return null;
  const trimmed = month.trim();
  return trimmed ? trimmed : null;
}
