import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DOC_GAPS_REFUSED,
  assertApplicationDocGapsEnabled,
  type ApplicationDocGapsResult,
} from "./application-doc-gaps";

const applicationDocGapsGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertApplicationDocGapsEnabled();
  return next();
});

export const getApplicationDocGaps = createServerFn({ method: "GET" })
  .middleware([applicationDocGapsGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApplicationDocGapsResult> => {
    // The assert throws while the flag is off, so a return after it never runs.
    // The read stays in the other branch, which the bundler drops with the flag.
    if (DOC_GAPS_REFUSED) {
      assertApplicationDocGapsEnabled();
    } else {
      const { loadApplicationDocGaps } = await import("./application-doc-gaps-load");
      const { requireManager } = await import("@/lib/roles.server");
      await requireManager(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return loadApplicationDocGaps(supabaseAdmin);
    }
  });
