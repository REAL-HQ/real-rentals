import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";
import { EXPIRY_WINDOW_DAYS, etCalendarDate, type ExpiringRenter, type ExpiryScope } from "@/lib/document-expiry";

export type ExpiringRenterDocuments = {
  todayEt: string;
  windowDays: number;
  defaultScope: ExpiryScope;
  renting: ExpiringRenter[];
  approved: ExpiringRenter[];
};

/** Manager read of Documents Expiring. Service role after requireManager; no document bytes. */
export const listExpiringRenterDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExpiringRenterDocuments> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadExpiringPopulation } = await import("@/lib/document-expiry.server");
    const now = new Date();
    const population = await loadExpiringPopulation(supabaseAdmin, now);
    return {
      todayEt: population.todayEt || etCalendarDate(now),
      windowDays: EXPIRY_WINDOW_DAYS,
      defaultScope: population.defaultScope,
      renting: population.renting,
      approved: population.approved,
    };
  });
