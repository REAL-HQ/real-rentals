import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DNC_REASON_MAX, type DncEntry, type DncIndexEntry } from "@/lib/dnc";
import type { DncNameSource } from "@/lib/dnc-added-by";
import type { DncTriggerMessage } from "@/lib/dnc-message";

/**
 * Staff side of the internal DNC List. Reading and "Move To DNC" are any staff
 * tier; "Remove From DNC" is Manager / Owner (checked here AND in dnc.server.ts,
 * because supabaseAdmin bypasses RLS). Every write is audited.
 */
async function deps() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logAudit } = await import("@/lib/audit.server");
  const core = await import("@/lib/dnc.server");
  return { admin: supabaseAdmin as any, audit: logAudit as any, core };
}

export const listDnc = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ installed: boolean; entries: DncEntry[]; nameSources: DncNameSource[] }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { admin, core } = await deps();
    return core.listDncEntries(admin);
  });

export const getDncIndex = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ installed: boolean; entries: DncIndexEntry[] }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { admin, core } = await deps();
    return core.listDncIndex(admin);
  });

export const moveToDnc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid().optional(),
        waitlistId: z.string().uuid().optional(),
        reason: z.string().max(DNC_REASON_MAX),
      })
      .refine((v) => !!v.applicationId !== !!v.waitlistId, "Choose One Person.")
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<DncEntry> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const { admin, audit, core } = await deps();
    return core.addToDnc(admin, actor, data, audit);
  });

/**
 * Where a DNC name should open. Waitlist signups that were promoted open that
 * application. The read uses the staff session, so a Coordinator who cannot
 * see the waitlist simply gets no application id.
 */
export const resolveDncProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ waitlistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{
    applicationId: string | null;
    phone: string | null;
    email: string | null;
    signedUp: string | null;
  }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const empty = { applicationId: null, phone: null, email: null, signedUp: null };
    const { data: row, error } = await context.supabase
      .from("waitlist")
      .select("phone, email, created_at, promoted_application_id")
      .eq("id", data.waitlistId)
      .maybeSingle();
    if (error || !row) return empty;
    let applicationId = row.promoted_application_id ?? null;
    if (applicationId) {
      const { data: app } = await context.supabase
        .from("applications")
        .select("id, deleted_at, status")
        .eq("id", applicationId)
        .maybeSingle();
      if (!app || app.deleted_at || app.status === "duplicate") applicationId = null;
    }
    return {
      applicationId,
      phone: row.phone ?? null,
      email: row.email ?? null,
      signedUp: row.created_at ?? null,
    };
  });

/**
 * Inbound text or email to show on each DNC row. Staff session only: RLS
 * decides what comes back, and dnc_list phone/email columns are not read.
 */
export const getDncTriggerMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }): Promise<{ messages: Record<string, DncTriggerMessage | null> }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { loadDncTriggerMessages } = await import("@/lib/dnc-message.server");
    // The staff client is typed to known tables. dnc_list is not in that
    // generated list, and this read only uses tables the session can already see.
    return {
      messages: await loadDncTriggerMessages(
        context.supabase as unknown as { from: (table: string) => any },
        data.ids,
      ),
    };
  });

export const removeFromDncList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(DNC_REASON_MAX) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<DncEntry> => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { admin, audit, core } = await deps();
    return core.removeFromDnc(admin, actor, data, audit);
  });
