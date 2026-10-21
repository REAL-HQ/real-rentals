import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEPOSIT_LEDGER_OFF, FINANCE_DEPOSIT_LEDGER_ENABLED } from "./finance-deposit-ledger-flag";
import type { DepositLedgerClient, DepositLedgerResponse } from "./finance-deposit-ledger.server";

/** Read-only. The flag throws before the role check and before any table read. */
export const getFinanceDepositLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ context }): Promise<DepositLedgerResponse> => {
    if (!FINANCE_DEPOSIT_LEDGER_ENABLED) throw new Error(DEPOSIT_LEDGER_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadDepositLedgerDirectory, runDepositLedger } = await import("./finance-deposit-ledger.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runDepositLedger({
      enabled: FINANCE_DEPOSIT_LEDGER_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      load: () => loadDepositLedgerDirectory(supabaseAdmin as unknown as DepositLedgerClient),
    });
  });
