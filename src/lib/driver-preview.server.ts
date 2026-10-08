// Secure, read-only "Viewing as [Driver]" support.
//
// The staff member stays signed in as themselves. No driver token or session
// is ever created. A portal READ may carry `previewDriverId`; this helper then
// verifies the caller is Owner/Manager, verifies the id is a real driver
// account, and returns a service-role client plus the driver's id so the
// existing portal queries (which all filter explicitly by user/driver id) run
// scoped to that one driver. Portal WRITES never accept a preview id, and
// refuseStaffPortalWrite() blocks staff from using driver write actions at all.
import type { SupabaseClient } from "@supabase/supabase-js";

export type PortalScope = { supabase: SupabaseClient<any>; userId: string; preview: boolean };

export async function portalScope(
  context: { supabase: any; userId: string },
  input: { previewDriverId?: string | null } | undefined,
  section: string,
): Promise<PortalScope> {
  const driverId = input?.previewDriverId ?? null;
  if (!driverId) return { supabase: context.supabase, userId: context.userId, preview: false };
  const { requireManager } = await import("@/lib/roles.server");
  const actor = await requireManager(context.userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ok = await isDriverAccount(supabaseAdmin, driverId);
  if (!ok) throw new Error("Driver not found");
  if (section === "dashboard") {
    const { logAudit } = await import("@/lib/audit");
    await logAudit(actor, {
      action: "driver_preview.access",
      summary: "Viewed driver portal in read-only preview",
      entityType: "driver",
      entityId: driverId,
      metadata: { section, context: "experience_selector_driver_preview" },
    });
  }
  return { supabase: supabaseAdmin as any, userId: driverId, preview: true };
}

export async function isDriverAccount(sb: any, userId: string): Promise<boolean> {
  const [{ data: role }, { data: app }] = await Promise.all([
    sb.from("user_roles").select("user_id").eq("user_id", userId).eq("role", "driver").limit(1).maybeSingle(),
    sb.from("applications").select("id").eq("user_id", userId).limit(1).maybeSingle(),
  ]);
  return Boolean(role || app);
}

/** Driver write actions are for drivers only; staff in preview are refused here, not just in the UI. */
export async function refuseStaffPortalWrite(userId: string): Promise<void> {
  const { getActor } = await import("@/lib/roles.server");
  const actor = await getActor(userId);
  if (!actor) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "driver").maybeSingle();
  if (!data) throw new Error("Driver Preview is read-only.");
}
