import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEPOSIT_LEDGER_ENABLED, DEPOSIT_LEDGER_OFF, DEPOSIT_RETURNS_DUE_ENABLED, DEPOSIT_RETURNS_DUE_OFF } from "./deposit-ledger-flag";
import type { DepositDirectoryClient, DepositLedgerResponse } from "./deposit-ledger.server";
import { etToday } from "./deposit-ledger";

function ledgerInput(data: unknown): { closedOnly: boolean } {
  if (data == null) return { closedOnly: false };
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("Deposit Ledger input could not be read");
  const closedOnly = (data as { closedOnly?: unknown }).closedOnly;
  if (closedOnly == null) return { closedOnly: false };
  if (typeof closedOnly !== "boolean") throw new Error("Deposit Ledger input could not be read");
  return { closedOnly };
}

/** Accepts the body without throwing. The handler checks the ledger flag before ledgerInput. */
function acceptLedgerInput(input: unknown): { closedOnly?: boolean } | null | undefined {
  if (input == null) return input as null | undefined;
  return input as { closedOnly?: boolean };
}

/** Read-only. While the flag is off this throws before the manager check and before any deposit or Stripe read. */
export const getDepositLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(acceptLedgerInput)
  .handler(async ({ data: raw, context }): Promise<DepositLedgerResponse> => {
    if (!DEPOSIT_LEDGER_ENABLED) throw new Error(DEPOSIT_LEDGER_OFF);
    const data = ledgerInput(raw);
    if (data.closedOnly && !DEPOSIT_RETURNS_DUE_ENABLED) throw new Error(DEPOSIT_RETURNS_DUE_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadDepositLedger, runDepositLedger } = await import("./deposit-ledger.server");
    const { readLiveDepositStripe } = await import("./deposit-ledger-stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runDepositLedger({
      enabled: DEPOSIT_LEDGER_ENABLED,
      returnsEnabled: DEPOSIT_RETURNS_DUE_ENABLED,
      includeDaysSinceClose: DEPOSIT_RETURNS_DUE_ENABLED,
      closedOnly: data.closedOnly && DEPOSIT_RETURNS_DUE_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      today: etToday(),
      load: () => loadDepositLedger(supabaseAdmin as unknown as DepositDirectoryClient),
      stripe: (payments) => readLiveDepositStripe(payments),
    });
  });
