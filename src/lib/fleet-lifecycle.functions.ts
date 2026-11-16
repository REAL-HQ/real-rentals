import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";

/** "By FLEET" captions for the Driver Lifecycle rail (audit_log, staff only). */
export const getFleetLifecycleMarks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readFleetLifecycleMarks } = await import("@/lib/fleet-lifecycle.server");
    return { marks: await readFleetLifecycleMarks(supabaseAdmin, data.applicationId) };
  });
