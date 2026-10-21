import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  APPLICATION_DOC_GAPS_ROW_CAP,
  DOC_GAPS_REFUSED,
  assertApplicationDocGapsEnabled,
  type ApplicationDocGapsResult,
} from "./application-doc-gaps";

const applicationDocGapsGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertApplicationDocGapsEnabled();
  return next();
});

const idle = (): ApplicationDocGapsResult => ({
  failed: false,
  truncated: false,
  cap: APPLICATION_DOC_GAPS_ROW_CAP,
  applications: [],
});

export const getApplicationDocGaps = createServerFn({ method: "GET" })
  .middleware([applicationDocGapsGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApplicationDocGapsResult> => {
    if (DOC_GAPS_REFUSED) {
      assertApplicationDocGapsEnabled();
      return idle();
    }
    const { loadApplicationDocGaps } = await import("./application-doc-gaps-load");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadApplicationDocGaps(supabaseAdmin);
  });
