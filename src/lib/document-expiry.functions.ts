import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";
import { EXPIRY_WINDOW_DAYS, etCalendarDate, type ExpiringRenter } from "@/lib/document-expiry";

export type ExpiringRenterDocuments = {
  todayEt: string;
  windowDays: number;
  renters: ExpiringRenter[];
};

/** Manager read of Documents Expiring. Service role after requireManager; no document bytes. */
export const listExpiringRenterDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExpiringRenterDocuments> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadExpiringRenters } = await import("@/lib/document-expiry.server");
    const now = new Date();
    return {
      todayEt: etCalendarDate(now),
      windowDays: EXPIRY_WINDOW_DAYS,
      renters: await loadExpiringRenters(supabaseAdmin, now),
    };
  });
