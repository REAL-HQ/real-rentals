import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertDriverReceiptsEnabled,
  buildDriverReceipts,
  type DriverReceipt,
  type ReceiptPayment,
  type ReceiptRental,
  type ReceiptVehicle,
} from "@/lib/driver-receipts";

const previewInput = (value: unknown): { previewDriverId?: string } => {
  const id = (value as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
};

const scope = async (context: { supabase: any; userId: string }, data: { previewDriverId?: string }, section: string) =>
  (await import("@/lib/driver-preview.server")).portalScope(context, data, section);

/**
 * Read-only. The caller's client after the existing portal scope. Preview
 * stays on that same read. Nothing here writes.
 */
export const getDriverReceipts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => input ?? {})
  .handler(async ({ data, context }): Promise<DriverReceipt[]> => {
    assertDriverReceiptsEnabled();
    const input = previewInput(data);
    const { supabase, userId } = await scope(context, input, "receipts");

    const applications = await supabase
      .from("applications")
      .select("id,full_name")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (applications.error) throw new Error(applications.error.message);
    const apps = applications.data ?? [];
    const appIds = apps.map((row: { id: string }) => row.id);
    const driverName =
      (apps.find((row: { full_name?: string | null }) => String(row.full_name ?? "").trim())?.full_name as string | null) ??
      null;

    const payments = appIds.length
      ? await supabase
          .from("payments")
          .select("id,paid_date,amount,type,status,rental_id,vehicle_id")
          .in("driver_id", appIds)
          .order("paid_date", { ascending: false, nullsFirst: false })
          .limit(200)
      : { data: [] as ReceiptPayment[], error: null };
    if (payments.error) throw new Error(payments.error.message);
    const rows = (payments.data ?? []) as ReceiptPayment[];

    const rentalIds = [...new Set(rows.map((row) => row.rental_id).filter((id): id is string => Boolean(id)))];
    const rentals = rentalIds.length
      ? await supabase.from("rentals").select("id,start_date,end_date,vehicle_id").in("id", rentalIds)
      : { data: [] as ReceiptRental[], error: null };

    const vehicleIds = [
      ...new Set(
        [
          ...rows.map((row) => row.vehicle_id),
          ...((rentals.data ?? []) as ReceiptRental[]).map((rental) => rental.vehicle_id),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    const vehicles = vehicleIds.length
      ? await supabase.from("vehicles").select("id,year,make,model,license_plate").in("id", vehicleIds)
      : { data: [] as ReceiptVehicle[], error: null };

    return buildDriverReceipts(rows, {
      driverName: driverName ? String(driverName).trim() || null : null,
      vehiclesReadable: !vehicles.error,
      vehicles: vehicles.error ? [] : ((vehicles.data ?? []) as ReceiptVehicle[]),
      rentalsReadable: !rentals.error,
      rentals: rentals.error ? [] : ((rentals.data ?? []) as ReceiptRental[]),
    });
  });
