import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertLeadResponseReportEnabled,
  loadLeadResponseReport,
  type LeadResponseReport,
} from "@/lib/lead-response-report";

/**
 * Manager-only read of response time and follow-ups. The flag refusal runs
 * before auth, before the role check, and again before the application read.
 */
const leadResponseReportGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertLeadResponseReportEnabled();
  return next();
});

export const getLeadResponseReport = createServerFn({ method: "POST" })
  .middleware([leadResponseReportGate, requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).strict().parse(input ?? {}))
  .handler(async ({ context }): Promise<LeadResponseReport> => {
    assertLeadResponseReportEnabled();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loaded = await loadLeadResponseReport(
      supabaseAdmin as unknown as Parameters<typeof loadLeadResponseReport>[0],
    );
    if (!loaded.ok) throw new Error("Lead response report is not enabled");
    return loaded.report;
  });
