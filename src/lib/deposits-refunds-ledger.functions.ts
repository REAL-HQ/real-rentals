import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEPOSITS_LEDGER_ENABLED } from "./deposits-refunds-flag";
import type { DepositsRefundsResponse } from "./deposits-refunds-ledger";

/**
 * Dark until DEPOSITS_LEDGER_ENABLED is changed and the app is rebuilt.
 * The disabled return happens before the role check and before any read.
 */
export const getDepositsRefundsLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DepositsRefundsResponse> => {
    if (!DEPOSITS_LEDGER_ENABLED) return { status: "disabled", report: null };
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { depositScans, loadDepositRecords, runDepositsRefunds } = await import("./deposits-refunds-ledger.server");
    const { readLiveDepositRefunds } = await import("./deposits-refunds-stripe.server");
    return runDepositsRefunds({
      enabled: true,
      userId: actor.userId,
      tier: actor.tier,
      load: () => loadDepositRecords(depositScans(supabaseAdmin)),
      readStripe: () => readLiveDepositRefunds(),
    });
  });
