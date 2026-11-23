/**
 * Manager+ edit of the name, phone, email and city/state on a driver profile.
 * Writes applications (and the copies saveDriverProfileEdit keeps aligned).
 * Does not email or text the driver.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager, requireStaff } from "@/lib/roles.server";
import { PROFILE_UPDATE_ACTION } from "@/lib/driver-profile-edit";

const draftSchema = z
  .object({
    applicationId: z.string().uuid(),
    firstName: z.string().max(80),
    lastName: z.string().max(80),
    phone: z.string().max(40),
    email: z.string().max(254),
    city: z.string().max(80),
    state: z.string().max(40),
  })
  .strict();

export type DriverProfileAuditRow = { at: string; summary: string };

export const updateDriverProfileBasics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => draftSchema.parse(data))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saveDriverProfileEdit } = await import("@/lib/driver-profile-edit.server");
    const { logAudit } = await import("@/lib/audit");
    return saveDriverProfileEdit(supabaseAdmin, actor, data, (entry) => logAudit(actor, entry));
  });

export const listDriverProfileUpdates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ applicationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<DriverProfileAuditRow[]> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("audit_log")
      .select("created_at,summary")
      .eq("action", PROFILE_UPDATE_ACTION)
      .eq("entity_type", "application")
      .eq("entity_id", data.applicationId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return [];
    return (rows ?? [])
      .map((row) => ({
        at: typeof row.created_at === "string" ? row.created_at : "",
        summary: typeof row.summary === "string" ? row.summary : "",
      }))
      .filter((row) => row.at && row.summary);
  });
