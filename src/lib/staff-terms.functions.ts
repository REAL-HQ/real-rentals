import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";

/**
 * Terms Confirmed row (Move Forward). Managers and Owners only: the terms
 * include the rate, Reservation Fee and deposit, which Coordinators do not see.
 */
export const getStaffTermsState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readStaffTermsState } = await import("@/lib/staff-terms.server");
    return readStaffTermsState(supabaseAdmin, data.applicationId);
  });

export const confirmStaffTermsMoveForward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      applicationId: z.string().uuid(),
      retry: z.boolean().optional(),
      /** Only when the record has none; saved into the blank record. */
      licenseNumber: z.string().max(40).optional(),
      terms: z.object({
        weekly_rate: z.union([z.number(), z.string()]),
        reservation_fee: z.union([z.number(), z.string()]),
        deposit: z.union([z.number(), z.string()]).optional(),
        start_date: z.string().max(20),
        vehicle_id: z.string().max(60),
      }),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { confirmStaffTerms } = await import("@/lib/staff-terms.server");
    const r = await confirmStaffTerms(supabaseAdmin, { applicationId: data.applicationId, terms: data.terms, actor, retry: data.retry === true, licenseNumber: data.licenseNumber ?? null });
    // The webhook payload stays server-side; the browser gets the outcome.
    return r.ok
      ? { ok: true as const, duplicate: r.duplicate, retried: r.retried, eventId: r.eventId, delivery: r.delivery, saved: r.saved ?? {} }
      : {
        ok: false as const,
        error: r.error,
        mismatches: (r.mismatches ?? []).map((m) => ({ field: m.field, confirmed: m.confirmed == null ? null : String(m.confirmed), agreement: m.agreement == null ? null : String(m.agreement) })),
        blockers: r.blockers ?? [],
        saved: r.saved ?? {},
      };
  });
