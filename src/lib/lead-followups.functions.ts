import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertLeadFollowupsEnabled, loadLeadFollowUp } from "@/lib/lead-followups";

/**
 * Staff preview of a follow-up draft. The flag refusal runs before auth,
 * before the role check, and again before the application read. It does not
 * send email or SMS.
 */
const leadFollowupGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertLeadFollowupsEnabled();
  return next();
});

export const prepareLeadFollowUp = createServerFn({ method: "POST" })
  .middleware([leadFollowupGate, requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ applicationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    assertLeadFollowupsEnabled();
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadLeadFollowUp(supabaseAdmin, data.applicationId);
  });
