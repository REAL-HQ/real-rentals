import { createServerFn } from "@tanstack/react-start";
import {
  assertDriverPaymentHistoryEnabled,
  buildPaymentHistory,
  DRIVER_PAYMENT_COLUMNS,
  type PaymentHistoryView,
  type PaymentRow,
} from "@/lib/driver-payment-history";

/**
 * The signed-in driver's own payments.
 *
 * The flag throws before any auth or table read. The client is the caller's
 * bearer session, so the existing driver SELECT policy applies. No service-role
 * client, and this read does not call a payment processor.
 */
export const getDriverPaymentHistory = createServerFn({ method: "POST" })
  .handler(async (): Promise<PaymentHistoryView> => {
    assertDriverPaymentHistoryEnabled();
    const { getRequest } = await import("@tanstack/react-start/server");
    const { createClient } = await import("@supabase/supabase-js");
    const request = getRequest();
    const authHeader = request?.headers?.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized: No authorization header provided");
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) throw new Error("Unauthorized: No token provided");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variable(s).");
    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !claims?.claims?.sub) throw new Error("Unauthorized: Invalid token");
    const userId = claims.claims.sub as string;

    const { data: apps, error: appError } = await supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId);
    if (appError) throw new Error(appError.message);
    const appIds = (apps ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (appIds.length === 0) return buildPaymentHistory([], []);

    let query = supabase.from("payments").select(DRIVER_PAYMENT_COLUMNS).limit(50);
    query = appIds.length === 1 ? query.eq("driver_id", appIds[0]) : query.in("driver_id", appIds);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return buildPaymentHistory((data ?? []) as PaymentRow[], appIds);
  });
