import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEPOSIT_LEDGER_ENABLED, DEPOSIT_LEDGER_OFF } from "./deposit-ledger-flag";
import type { DepositDirectoryClient, DepositLedgerResponse } from "./deposit-ledger.server";
import { etToday } from "./deposit-ledger";

/** Read-only. While the flag is off this throws before the manager check and before any deposit read. */
export const getDepositLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DepositLedgerResponse> => {
    if (!DEPOSIT_LEDGER_ENABLED) throw new Error(DEPOSIT_LEDGER_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadDepositLedger, runDepositLedger } = await import("./deposit-ledger.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runDepositLedger({
      enabled: DEPOSIT_LEDGER_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      today: etToday(),
      load: () => loadDepositLedger(supabaseAdmin as unknown as DepositDirectoryClient),
    });
  });
