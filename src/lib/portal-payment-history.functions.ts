import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertPortalPaymentHistoryEnabled,
  paymentHistory,
  type PaymentHistoryItem,
  type PaymentHistoryRow,
} from "@/lib/portal-payment-history";

function previewInput(d: unknown): { previewDriverId?: string } {
  const id = (d as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
}

/**
 * The signed-in driver's past payments.
 *
 * Read with the caller's own Supabase client. A driver SELECT is limited by
 * "Drivers can view their own payments" to rows whose driver_id is an
 * application they own. A manager in Driver Preview uses that same client:
 * "Managers manage payments" already lets them SELECT, and the query is
 * still limited to the previewed driver's applications. No service role,
 * no Stripe.
 */
export const getPortalPaymentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ context, data }): Promise<PaymentHistoryItem[]> => {
    assertPortalPaymentHistoryEnabled();
    let userId = context.userId;
    if (data.previewDriverId) {
      const { requireManager } = await import("@/lib/roles.server");
      await requireManager(context.userId);
      userId = data.previewDriverId;
    }

    const { data: apps, error: appError } = await context.supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId);
    if (appError) throw new Error("Could not load your payments.");
    const appIds = (apps ?? []).map((app: { id: string }) => app.id);
    if (appIds.length === 0) return [];

    const { data: rows, error } = await context.supabase
      .from("payments")
      .select("id,status,amount,type,reason,paid_date,refunded_at,last_attempt_at,created_at")
      .in("driver_id", appIds)
      .in("status", ["paid", "failed", "refunded"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Could not load your payments.");

    return paymentHistory((rows ?? []) as PaymentHistoryRow[]);
  });
