import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RENEWALS_DUE_ENABLED } from "./renewals-due-flag";
import {
  RENEWALS_FETCH_LIMIT,
  buildRenewalsDue,
  easternCalendarDate,
  renewalHorizon,
  type RenewalApplication,
  type RenewalPayment,
  type RenewalRental,
  type RenewalVehicle,
  type RenewalsDueBoard,
} from "./renewals-due";

const RENTAL_COLUMNS = "id,status,driver_id,application_id,vehicle_id,weekly_rate,end_date,next_payment_due";

export const getRenewalsDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RenewalsDueBoard> => {
    if (!RENEWALS_DUE_ENABLED) throw new Error("Rental Renewal Due is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const today = easternCalendarDate();
    const horizon = renewalHorizon(today);
    const [billingQ, endQ] = await Promise.all([
      supabaseAdmin
        .from("rentals")
        .select(RENTAL_COLUMNS, { count: "exact" })
        .eq("status", "active")
        .gte("next_payment_due", today)
        .lte("next_payment_due", horizon)
        .limit(RENEWALS_FETCH_LIMIT),
      supabaseAdmin
        .from("rentals")
        .select(RENTAL_COLUMNS, { count: "exact" })
        .eq("status", "active")
        .gte("end_date", today)
        .lte("end_date", horizon)
        .limit(RENEWALS_FETCH_LIMIT),
    ]);
    if (billingQ.error) throw new Error(billingQ.error.message);
    if (endQ.error) throw new Error(endQ.error.message);

    const byId = new Map<string, RenewalRental>();
    for (const row of [...(billingQ.data ?? []), ...(endQ.data ?? [])]) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    const rentals = [...byId.values()];
    const over = (count: number | null, rows: number) => (count ?? rows) > RENEWALS_FETCH_LIMIT;
    if (rentals.length === 0) {
      return buildRenewalsDue({
        today,
        rentals,
        applications: [],
        vehicles: [],
        payments: [],
        billingTruncated: over(billingQ.count, billingQ.data?.length ?? 0),
        endTruncated: over(endQ.count, endQ.data?.length ?? 0),
      });
    }

    const applicationIds = [...new Set(rentals.map((row) => row.application_id).filter((id): id is string => !!id))];
    const vehicleIds = [...new Set(rentals.map((row) => row.vehicle_id).filter((id): id is string => !!id))];
    const rentalIds = rentals.map((row) => row.id);

    const [applicationsQ, vehiclesQ, paymentsQ] = await Promise.all([
      applicationIds.length === 0
        ? Promise.resolve({ data: [] as RenewalApplication[], error: null, count: 0 })
        : supabaseAdmin
            .from("applications")
            .select("id,full_name", { count: "exact" })
            .in("id", applicationIds)
            .limit(RENEWALS_FETCH_LIMIT),
      vehicleIds.length === 0
        ? Promise.resolve({ data: [] as RenewalVehicle[], error: null, count: 0 })
        : supabaseAdmin
            .from("vehicles")
            .select("id,year,make,model,unit_number,license_plate", { count: "exact" })
            .in("id", vehicleIds)
            .limit(RENEWALS_FETCH_LIMIT),
      supabaseAdmin
        .from("payments")
        .select("id,rental_id,status,created_at", { count: "exact" })
        .in("rental_id", rentalIds)
        .order("created_at", { ascending: false })
        .limit(RENEWALS_FETCH_LIMIT),
    ]);
    if (applicationsQ.error) throw new Error(applicationsQ.error.message);
    if (vehiclesQ.error) throw new Error(vehiclesQ.error.message);
    if (paymentsQ.error) throw new Error(paymentsQ.error.message);

    const applications: RenewalApplication[] = applicationsQ.data ?? [];
    const vehicles: RenewalVehicle[] = vehiclesQ.data ?? [];
    const payments: RenewalPayment[] = paymentsQ.data ?? [];

    return buildRenewalsDue({
      today,
      rentals,
      applications,
      vehicles,
      payments,
      billingTruncated: over(billingQ.count, billingQ.data?.length ?? 0),
      endTruncated: over(endQ.count, endQ.data?.length ?? 0),
      applicationsTruncated: over(applicationsQ.count, applications.length),
      vehiclesTruncated: over(vehiclesQ.count, vehicles.length),
      paymentsTruncated: over(paymentsQ.count, payments.length),
    });
  });
