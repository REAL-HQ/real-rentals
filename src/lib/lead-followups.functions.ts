import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";

/**
 * Staff preview of a follow-up draft. With the flag off this returns before
 * any application read. It does not send email or SMS.
 */
export const prepareLeadFollowUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const { LEAD_FOLLOWUPS_ENABLED, loadLeadFollowUp } = await import("@/lib/lead-followups");
    if (LEAD_FOLLOWUPS_ENABLED !== true) return { ok: false as const, skipped: "flag" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadLeadFollowUp(supabaseAdmin, data.applicationId);
  });
