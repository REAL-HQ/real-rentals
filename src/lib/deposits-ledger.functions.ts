import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DepositPeriod } from "./deposits-ledger";
import { DEPOSITS_LEDGER_ENABLED } from "./deposits-ledger-flag";
import { readLiveDepositsLedger } from "./deposits-ledger-read.server";
import { loadDepositsDirectory, runDepositsLedger, type DepositsLedgerResponse } from "./deposits-ledger.server";

/** Read-only. The flag returns before roles, deposit rows, and Stripe. */
export const getDepositsLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown): { period: DepositPeriod | null } => {
    const period = data && typeof data === "object" && "period" in data ? (data as { period?: unknown }).period : null;
    return period === "this_month" || period === "last_month" || period === "last_90" ? { period } : { period: null };
  })
  .handler(async ({ data, context }): Promise<DepositsLedgerResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readReservationDepositSettings, RESERVATION_DEPOSIT_SETTINGS_KEY } = await import("./reservation-deposit-settings");
    let reservationOn = false;
    try {
      const { data: row } = await supabaseAdmin.from("app_settings").select("value").eq("key", RESERVATION_DEPOSIT_SETTINGS_KEY).maybeSingle();
      reservationOn = readReservationDepositSettings(row?.value).enabled === true;
    } catch {
      reservationOn = false;
    }
    const enabled = DEPOSITS_LEDGER_ENABLED || reservationOn;
    if (!enabled) return { status: "disabled", report: null };
    if (!data.period) return { status: "unavailable", reason: "The period is not recognized", report: null };
    if (!context.userId) throw new Error("Forbidden");
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    return runDepositsLedger({
      enabled,
      userId: context.userId,
      roles: roles.map((row) => row.role),
      period: data.period,
      load: () => loadDepositsDirectory(context.supabase),
      readStripe: (window) => readLiveDepositsLedger(window),
    });
  });
