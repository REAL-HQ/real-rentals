import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AGING_REFUSED, assertWaitlistAgingEnabled, idleWaitlistAging } from "./waitlist-aging";

// Runs before auth. A dark flag must not ask who the caller is, and must not read.
const waitlistAgingGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertWaitlistAgingEnabled();
  return next();
});

export const getWaitlistAging = createServerFn({ method: "POST" })
  .middleware([waitlistAgingGate, requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (AGING_REFUSED) {
      assertWaitlistAgingEnabled();
      return idleWaitlistAging();
    }
    const { loadWaitlistAging } = await import("./waitlist-aging-load");
    // The waitlist screen is staff. Coordinators already see the queue.
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadWaitlistAging(supabaseAdmin);
  });
