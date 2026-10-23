import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ACCOUNTANT_EXPORT_ENABLED } from "./accountant-export-flag";
import type { AccountantExportResponse } from "./accountant-export.server";

/**
 * Owner-only year export. While ACCOUNTANT_EXPORT_ENABLED is false this
 * returns before the owner check and before any table or Stripe read.
 * Charges are listed once, by readLivePartnerCharges. No writes, no new SQL, no email.
 */

const DISABLED: AccountantExportResponse = { status: "disabled", report: null };

export const getAccountantExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(async ({ data, context }): Promise<AccountantExportResponse> => {
    if (!ACCOUNTANT_EXPORT_ENABLED) return DISABLED;
    const year = z.object({ year: z.string().regex(/^\d{4}$/) }).parse(data ?? {}).year;
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadAccountantSources, runAccountantExport } = await import("./accountant-export.server");
    const { readLivePartnerCharges } = await import("./partner-statement-read.server");
    return runAccountantExport({
      enabled: true,
      userId: context.userId,
      tier: "owner",
      year,
      load: () => loadAccountantSources(supabaseAdmin),
      readCharges: (window) => readLivePartnerCharges(window),
    });
  });
