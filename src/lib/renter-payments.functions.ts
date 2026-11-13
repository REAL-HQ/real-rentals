import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  toRenterPaymentListItem,
  visibleRenterPayments,
  type RenterPaymentListItem,
} from "@/lib/renter-payments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAYMENT_COLUMNS =
  "id,paid_date,stripe_paid_at,amount,status,rental_id,driver_id,stripe_invoice_number,stripe_receipt_url,stripe_hosted_invoice_url,stripe_invoice_pdf_url";

async function requireStaff(userId: string | undefined) {
  if (!userId) throw new Error("Forbidden");
  const { requireManager } = await import("@/lib/roles.server");
  return requireManager(userId);
}

type PaymentRow = {
  id: string;
  paid_date: string | null;
  stripe_paid_at: string | null;
  amount: number | null;
  status: string | null;
  rental_id: string | null;
  driver_id: string | null;
  stripe_invoice_number: string | null;
  stripe_receipt_url: string | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf_url: string | null;
};

function sortItems(items: RenterPaymentListItem[]): RenterPaymentListItem[] {
  return [...items].sort((a, b) => {
    const aKey = a.paidAt ?? a.paidDate ?? "";
    const bKey = b.paidAt ?? b.paidDate ?? "";
    return bKey.localeCompare(aKey);
  });
}

/** Read-only. Staff list of successful payments on one renter's profile. */
export const getRenterPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown): { driverId: string } => {
    const driverId = data && typeof data === "object" && "driverId" in data ? (data as { driverId?: unknown }).driverId : "";
    if (typeof driverId !== "string" || !UUID.test(driverId)) throw new Error("Invalid driver");
    return { driverId };
  })
  .handler(async ({ data, context }): Promise<{ payments: RenterPaymentListItem[] }> => {
    await requireStaff(context.userId);
    const { data: rentals, error: rentalError } = await context.supabase
      .from("rentals")
      .select("id")
      .eq("application_id", data.driverId);
    if (rentalError) throw new Error(rentalError.message);
    const rentalIds = (rentals ?? []).map((row: { id: string }) => row.id);

    const byDriver = await context.supabase
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("driver_id", data.driverId)
      .order("paid_date", { ascending: false, nullsFirst: false })
      .limit(200);
    if (byDriver.error) throw new Error(byDriver.error.message);

    const byRental = rentalIds.length
      ? await context.supabase
          .from("payments")
          .select(PAYMENT_COLUMNS)
          .in("rental_id", rentalIds)
          .order("paid_date", { ascending: false, nullsFirst: false })
          .limit(200)
      : { data: [] as PaymentRow[], error: null };
    if (byRental.error) throw new Error(byRental.error.message);

    const rows = [...((byDriver.data ?? []) as PaymentRow[]), ...((byRental.data ?? []) as PaymentRow[])];
    const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
    return { payments: sortItems(visibleRenterPayments(unique).map(toRenterPaymentListItem)) };
  });

/** Read-only. Successful payments stored without a renter or rental match. */
export const getUnmatchedRenterPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data ?? {})
  .handler(async ({ context }): Promise<{ payments: RenterPaymentListItem[] }> => {
    await requireStaff(context.userId);
    const { data: rows, error } = await context.supabase
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .is("driver_id", null)
      .is("rental_id", null)
      .order("paid_date", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { payments: sortItems(visibleRenterPayments((rows ?? []) as PaymentRow[]).map(toRenterPaymentListItem)) };
  });
