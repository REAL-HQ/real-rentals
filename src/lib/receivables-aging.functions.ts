import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RECEIVABLES_AGING_ENABLED, RECEIVABLES_AGING_OFF } from "./receivables-aging-flag";
import type { AgingDirectoryClient, AgingResponse } from "./receivables-aging.server";
import { etToday } from "./receivables-aging";

/** Read-only. While the flag is off this throws before the manager check and before any receivable read. */
export const getReceivablesAging = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgingResponse> => {
    if (!RECEIVABLES_AGING_ENABLED) throw new Error(RECEIVABLES_AGING_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadReceivablesAging, runReceivablesAging } = await import("./receivables-aging.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runReceivablesAging({
      enabled: RECEIVABLES_AGING_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      today: etToday(),
      load: () => loadReceivablesAging(supabaseAdmin as unknown as AgingDirectoryClient),
    });
  });
