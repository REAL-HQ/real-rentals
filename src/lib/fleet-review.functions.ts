import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Staff side of FLEET's Needs Staff queue (public.fleet_review_decisions).
 * Staff read the open flags; a Manager resolves one after deciding (approve,
 * decline or close through the usual controls). Before the table exists the
 * list is empty and resolve explains why.
 */
export type FleetNeedsStaffFlag = {
  id: string;
  applicationId: string;
  reason: string;
  escalationCodes: string[];
  createdAt: string | null;
};

export const listFleetNeedsStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ flags: FleetNeedsStaffFlag[]; available: boolean }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await (supabaseAdmin as any)
      .from("fleet_review_decisions")
      .select("id,application_id,reason,escalation_codes,created_at")
      .eq("decision", "needs_staff")
      .is("resolved_at", null)
      .order("created_at", { ascending: true })
      .limit(500);
    if (res.error) return { flags: [], available: false };
    return {
      available: true,
      flags: (res.data ?? []).map((r: any) => ({
        id: r.id,
        applicationId: r.application_id,
        reason: r.reason,
        escalationCodes: Array.isArray(r.escalation_codes) ? r.escalation_codes.map(String) : [],
        createdAt: r.created_at ?? null,
      })),
    };
  });

export const resolveFleetNeedsStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), note: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await (supabaseAdmin as any)
      .from("fleet_review_decisions")
      .update({ resolved_at: new Date().toISOString(), resolved_by: context.userId, resolution_note: data.note || null })
      .eq("id", data.id)
      .eq("decision", "needs_staff")
      .is("resolved_at", null)
      .select("id,application_id");
    if (res.error) return { ok: false, error: "Could Not Clear The Flag." };
    const row = res.data?.[0];
    if (!row) return { ok: false, error: "That Flag Is Already Cleared." };
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "application.fleet_needs_staff_resolved",
      summary: "Cleared FLEET's Needs Staff flag",
      entityType: "application",
      entityId: row.application_id,
      metadata: { decision_id: row.id, note: data.note || null },
    });
    return { ok: true };
  });
