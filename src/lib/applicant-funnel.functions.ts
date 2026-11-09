import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertApplicantFunnelEnabled,
  buildApplicantFunnel,
  funnelWindow,
  type ApplicantFunnelReport,
  type FunnelApplication,
  type FunnelRange,
} from "@/lib/applicant-funnel";

const PAGE = 1000;
const CHUNK = 100;

/**
 * Managers only. Read-only. The flag throws before the role check and before
 * any table read. Approval time comes from the existing application.approved
 * audit row. A rental is any rentals row for the application.
 */
export const getApplicantFunnel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }).parse(input))
  .handler(async ({ data, context }): Promise<ApplicantFunnelReport> => {
    assertApplicantFunnelEnabled();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);

    const window = funnelWindow(data.days as FunnelRange);
    const raw: { id: string; status: string; created_at: string }[] = [];
    let offset = 0;
    for (;;) {
      const { data: page, error } = await context.supabase
        .from("applications")
        .select("id,status,created_at")
        .is("deleted_at", null)
        .gte("created_at", window.start)
        .lte("created_at", window.end)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!page) throw new Error("Application data unavailable");
      raw.push(...(page as { id: string; status: string; created_at: string }[]));
      if (page.length < PAGE) break;
      offset += PAGE;
    }

    const approvedAt = new Map<string, string>();
    const firstRentalAt = new Map<string, string>();
    const ids = raw.map((row) => row.id);
    for (let index = 0; index < ids.length; index += CHUNK) {
      const chunk = ids.slice(index, index + CHUNK);
      const [rentals, audits] = await Promise.all([
        context.supabase.from("rentals").select("application_id,created_at").in("application_id", chunk),
        context.supabase
          .from("audit_log")
          .select("entity_id,created_at")
          .eq("action", "application.approved")
          .eq("entity_type", "application")
          .in("entity_id", chunk),
      ]);
      if (rentals.error) throw new Error(rentals.error.message);
      if (audits.error) throw new Error(audits.error.message);
      for (const row of rentals.data ?? []) {
        if (!row.application_id || !row.created_at) continue;
        const previous = firstRentalAt.get(row.application_id);
        if (!previous || row.created_at < previous) firstRentalAt.set(row.application_id, row.created_at);
      }
      for (const row of audits.data ?? []) {
        if (!row.entity_id || !row.created_at) continue;
        const previous = approvedAt.get(row.entity_id);
        if (!previous || row.created_at < previous) approvedAt.set(row.entity_id, row.created_at);
      }
    }

    const applications: FunnelApplication[] = raw.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      approvedAt: approvedAt.get(row.id) ?? null,
      firstRentalAt: firstRentalAt.get(row.id) ?? null,
    }));
    return buildApplicantFunnel(applications, window);
  });
