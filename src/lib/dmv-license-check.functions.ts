import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DMV_CHECK_STATUS_KEYS, type DmvCheck, type DmvCheckStatus } from "@/lib/dmv-license-check";

/**
 * Staff side of the State DMV License Check. Any staff tier can read and log
 * (the server checks the tier because supabaseAdmin bypasses RLS).
 */
async function deps() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logAudit } = await import("@/lib/audit.server");
  const core = await import("@/lib/dmv-license-check.server");
  return { admin: supabaseAdmin as any, audit: logAudit as any, core };
}

export type DmvProfile = { installed: boolean; checks: DmvCheck[]; licenseState: string | null; serverNow: number };

export const getDmvLicenseProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<DmvProfile> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { admin, core } = await deps();
    const r = await core.listDmvChecks(admin, data.applicationId);
    const app = await admin.from("applications").select("license_state").eq("id", data.applicationId).maybeSingle();
    return { installed: r.installed, checks: r.checks, licenseState: app.data?.license_state ?? null, serverNow: Date.now() };
  });

export const logDmvLicenseCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        status: z.enum(DMV_CHECK_STATUS_KEYS as [DmvCheckStatus, ...DmvCheckStatus[]]),
        licenseState: z.string().length(2),
        note: z.string().max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ check: DmvCheck; routed: "opened" | "extended" | null }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const { admin, audit, core } = await deps();
    return core.logDmvCheck(admin, actor, data, audit);
  });
