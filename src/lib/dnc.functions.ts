import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DNC_REASON_MAX, type DncEntry, type DncIndexEntry } from "@/lib/dnc";

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
  .handler(async ({ context }): Promise<{ installed: boolean; entries: DncEntry[] }> => {
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
