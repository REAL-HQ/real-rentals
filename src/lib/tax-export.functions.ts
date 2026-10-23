import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TAX_EXPORT_ENABLED, TAX_EXPORT_OFF } from "./tax-export-flag";
import type { TaxExportClient, TaxExportResponse } from "./tax-export.server";

/** Read-only. While the flag is off this throws before the owner check and before any read. */
export const getTaxExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<TaxExportResponse> => {
    if (!TAX_EXPORT_ENABLED) throw new Error(TAX_EXPORT_OFF);
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { loadTaxExportDirectory, runTaxExport } = await import("./tax-export.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runTaxExport({
      enabled: TAX_EXPORT_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      now: new Date(),
      year: yearFrom(data),
      load: () => loadTaxExportDirectory(supabaseAdmin as unknown as TaxExportClient),
    });
  });

function yearFrom(data: unknown): number | null {
  if (!data || typeof data !== "object" || !("year" in data)) return null;
  const year = (data as { year?: unknown }).year;
  if (year == null || year === "") return null;
  if (typeof year === "number" && Number.isInteger(year)) return year;
  if (typeof year === "string" && /^\d{4}$/.test(year)) return Number(year);
  return Number.NaN;
}
