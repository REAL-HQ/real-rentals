import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PORTAL_PAYMENT_HISTORY_ENABLED } from "@/lib/portal-payment-history-flag";
import {
  HISTORY_CHUNK,
  HISTORY_READ_CAP,
  buildPortalPaymentHistory,
  type HistoryRow,
  type PortalPaymentHistory,
} from "@/lib/portal-payment-history";

const PAYMENT_COLUMNS =
  "id,type,status,amount,balance_due,net_collected,refunded_amount,due_date,paid_date,created_at,payment_method";

/** Refuses before auth. The handler never receives a driver id from the client. */
const portalPaymentHistoryGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) throw new Error("Payment history is not enabled.");
  return next();
});

function chunks(ids: readonly string[]): string[][] {
  const groups: string[][] = [];
  for (let index = 0; index < ids.length; index += HISTORY_CHUNK) {
    groups.push(ids.slice(index, index + HISTORY_CHUNK));
  }
  return groups;
}

async function ownedIds(
  admin: { from: (table: string) => any },
  table: "applications" | "rentals",
  column: "user_id" | "driver_id",
  userId: string,
): Promise<{ ids: string[]; truncated: boolean }> {
  const page = await admin
    .from(table)
    .select("id")
    .eq(column, userId)
    .order("id", { ascending: true })
    .limit(HISTORY_READ_CAP + 1);
  if (page.error) throw new Error("Payment history could not be loaded.");
  const rows = (page.data ?? []) as { id: string }[];
  const truncated = rows.length > HISTORY_READ_CAP;
  return { ids: (truncated ? rows.slice(0, HISTORY_READ_CAP) : rows).map((row) => row.id).filter(Boolean), truncated };
}

async function paymentRows(
  admin: { from: (table: string) => any },
  column: "driver_id" | "rental_id",
  ids: readonly string[],
): Promise<{ rows: HistoryRow[]; truncated: boolean }> {
  const rows: HistoryRow[] = [];
  let truncated = false;
  for (const group of chunks(ids)) {
    const page = await admin
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .in(column, group)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_READ_CAP + 1);
    if (page.error) throw new Error("Payment history could not be loaded.");
    const found = (page.data ?? []) as HistoryRow[];
    if (found.length > HISTORY_READ_CAP) truncated = true;
    rows.push(...(found.length > HISTORY_READ_CAP ? found.slice(0, HISTORY_READ_CAP) : found));
  }
  return { rows, truncated };
}

export const getPortalPaymentHistory = createServerFn({ method: "GET" })
  .middleware([portalPaymentHistoryGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortalPaymentHistory> => {
    if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) throw new Error("Payment history is not enabled.");
    const userId = context.userId;
    if (typeof userId !== "string" || userId.trim() === "") throw new Error("Payment history could not be loaded.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const applications = await ownedIds(supabaseAdmin, "applications", "user_id", userId);
    const rentals = await ownedIds(supabaseAdmin, "rentals", "driver_id", userId);
    const byDriver = applications.ids.length
      ? await paymentRows(supabaseAdmin, "driver_id", applications.ids)
      : { rows: [], truncated: false };
    const byRental = rentals.ids.length
      ? await paymentRows(supabaseAdmin, "rental_id", rentals.ids)
      : { rows: [], truncated: false };

    return buildPortalPaymentHistory({
      rows: [...byDriver.rows, ...byRental.rows],
      truncated: applications.truncated || rentals.truncated || byDriver.truncated || byRental.truncated,
    });
  });
