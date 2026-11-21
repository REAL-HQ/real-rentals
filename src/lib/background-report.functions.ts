import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BACKGROUND_PROVIDERS,
  BACKGROUND_REPORT_TYPES,
  CRIMINAL_RESULTS,
  IDENTITY_RESULTS,
  LICENSE_STATUSES,
  MAX_CASES,
  MAX_FILES_PER_REPORT,
  cleanCases,
} from "@/lib/background-report";
import type { BackgroundReportWithFiles } from "@/lib/background-report";

/**
 * Staff side of Background reports. Manager and above, the same tier that can
 * read and upload a driver's documents (criminal case details are at least as
 * sensitive). Server functions run as the service role, so the check is here.
 */

export const listDriverBackgroundReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ installed: boolean; reports: BackgroundReportWithFiles[] }> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listBackgroundReports } = await import("@/lib/background-report.server");
    return listBackgroundReports(supabaseAdmin, data.applicationId);
  });

const CaseSchema = z.object({
  case_number: z.string().max(80).nullable().optional(),
  alt_case_numbers: z.array(z.string().max(80)).max(5).optional(),
  internal_id: z.string().max(80).nullable().optional(),
  date: z.string().max(40).nullable().optional(),
  file_date: z.string().max(40).nullable().optional(),
  offense: z.string().max(300).nullable().optional(),
  level: z.string().max(60).nullable().optional(),
  disposition: z.string().max(200).nullable().optional(),
  jurisdiction: z.string().max(120).nullable().optional(),
});

export const saveDriverBackgroundReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        reportId: z.string().uuid().nullable().optional(),
        provider: z.enum(BACKGROUND_PROVIDERS),
        providerName: z.string().max(80).nullable().optional(),
        reportType: z.enum(BACKGROUND_REPORT_TYPES).nullable().optional(),
        reference: z.string().max(60).nullable().optional(),
        reportRef: z.string().max(300).nullable().optional(),
        licenseStatus: z.enum(LICENSE_STATUSES).nullable().optional(),
        licenseState: z.string().regex(/^[A-Za-z]{2}$/).nullable().optional(),
        criminalRecord: z.enum(CRIMINAL_RESULTS).nullable().optional(),
        criminalCaseCount: z.number().int().min(0).max(999).nullable().optional(),
        criminalCases: z.array(CaseSchema).max(MAX_CASES).optional(),
        identityResult: z.enum(IDENTITY_RESULTS).nullable().optional(),
        checkedAt: z.string().max(40).nullable().optional(),
        documentIds: z.array(z.string().uuid()).max(MAX_FILES_PER_REPORT).optional(),
        note: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    const { saveBackgroundReport, BackgroundReportError } = await import("@/lib/background-report.server");
    let checkedAt: string | null = null;
    if (data.checkedAt) {
      const d = new Date(data.checkedAt);
      if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 5 * 60_000) throw new Error("Checked On Must Be A Real Date, Not In The Future.");
      checkedAt = d.toISOString();
    }
    try {
      const { report } = await saveBackgroundReport(
        supabaseAdmin,
        {
          applicationId: data.applicationId,
          reportId: data.reportId ?? null,
          provider: data.provider,
          providerName: data.providerName ?? null,
          reportType: data.reportType ?? null,
          reference: data.reference ?? null,
          reportRef: data.reportRef ?? null,
          licenseStatus: data.licenseStatus ?? null,
          licenseState: data.licenseState ? data.licenseState.toUpperCase() : null,
          criminalRecord: data.criminalRecord ?? null,
          criminalCaseCount: data.criminalCaseCount ?? null,
          criminalCases: cleanCases(data.criminalCases ?? []) ?? [],
          identityResult: data.identityResult ?? null,
          checkedAt,
          documentIds: data.documentIds ?? [],
          note: data.note ?? null,
          source: "staff",
          recordedBy: actor.userId,
          recordedByLabel: actor.email ?? "Staff",
        },
        (e) => logAudit(actor as any, e as any),
      );
      return { ok: true as const, report };
    } catch (e) {
      if (e instanceof BackgroundReportError) throw new Error(e.message);
      throw e;
    }
  });
