import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildActiveRentalRows,
  etDateISO,
  type ActiveRentalRow,
  type IncidentFact,
  type IssueFact,
  type PaymentFact,
  type ReadResult,
} from "@/lib/active-rentals";

// Manager board for rentals that are out right now.
//
// Coordinators may read a rental row (who has which car) on Bookings. This
// board also reads payments, incidents, and driver issues. Those policies are
// manager-only (payments and incidents) or admin/team (issues), so the service
// role repeats requireManager and does not use requireStaff.
//
// Last payment status is the latest public.payments row, including its Stripe
// invoice or payment-intent id. Next due is rentals.next_payment_due. This
// does not call Stripe Collections, Unified Finance, or Reconciliation.

async function gate(userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  return requireManager(userId);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? "")).filter((value) => UUID.test(value)))];
}

async function readRows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<ReadResult<T>> {
  try {
    const { data, error } = await query;
    if (error) return { ok: false };
    return { ok: true, rows: data ?? [] };
  } catch {
    return { ok: false };
  }
}

export const listActiveRentals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<{
    rows: ActiveRentalRow[];
    today: string;
    paymentsLoaded: boolean;
    issuesLoaded: boolean;
    incidentsLoaded: boolean;
    documentsLoaded: boolean;
  }> => {
    await gate(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = etDateISO();

    const { data: rentals, error } = await supabaseAdmin
      .from("rentals")
      .select("id,driver_id,application_id,vehicle_id,start_date,weekly_rate,next_payment_due,status")
      .eq("status", "active")
      .order("start_date", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    const list = rentals ?? [];
    if (!list.length) {
      return { rows: [], today, paymentsLoaded: true, issuesLoaded: true, incidentsLoaded: true, documentsLoaded: true };
    }

    const rentalIds = ids(list.map((r) => r.id));
    const driverIds = ids(list.map((r) => r.driver_id));
    const vehicleIds = ids(list.map((r) => r.vehicle_id));
    const applicationIds = ids(list.map((r) => r.application_id));

    const [payments, issues, incidentsByVehicle, incidentsByRental, applications, vehicles] = await Promise.all([
      readRows<PaymentFact>(
        supabaseAdmin
          .from("payments")
          .select("rental_id,status,paid_date,due_date,created_at,stripe_invoice_id,stripe_payment_intent_id")
          .in("rental_id", rentalIds)
          .order("created_at", { ascending: false })
          .limit(5000)
          .then((res) => ({
            error: res.error,
            data: (res.data ?? []).map((row) => ({
              rentalId: row.rental_id,
              status: row.status,
              paidDate: row.paid_date,
              dueDate: row.due_date,
              createdAt: row.created_at,
              stripeInvoiceId: row.stripe_invoice_id,
              stripePaymentIntentId: row.stripe_payment_intent_id,
            })),
          })),
      ),
      readRows<IssueFact>(
        supabaseAdmin
          .from("issues")
          .select("rental_id,driver_id,vehicle_id,status")
          .in("driver_id", driverIds)
          .limit(2000)
          .then((res) => ({
            error: res.error,
            data: (res.data ?? []).map((row) => ({
              rentalId: row.rental_id,
              driverId: row.driver_id,
              vehicleId: row.vehicle_id,
              status: row.status,
            })),
          })),
      ),
      readRows<IncidentFact>(
        supabaseAdmin
          .from("incidents")
          .select("id,rental_id,vehicle_id,status")
          .in("vehicle_id", vehicleIds)
          .limit(2000)
          .then((res) => ({
            error: res.error,
            data: (res.data ?? []).map((row) => ({
              id: row.id,
              rentalId: row.rental_id,
              vehicleId: row.vehicle_id,
              status: row.status,
            })),
          })),
      ),
      readRows<IncidentFact>(
        supabaseAdmin
          .from("incidents")
          .select("id,rental_id,vehicle_id,status")
          .in("rental_id", rentalIds)
          .limit(2000)
          .then((res) => ({
            error: res.error,
            data: (res.data ?? []).map((row) => ({
              id: row.id,
              rentalId: row.rental_id,
              vehicleId: row.vehicle_id,
              status: row.status,
            })),
          })),
      ),
      readRows<{ id: string; full_name: string | null; license_expiration: string | null; insurance_expires_on: string | null }>(
        applicationIds.length
          ? supabaseAdmin
              .from("applications")
              .select("id,full_name,license_expiration,insurance_expires_on")
              .in("id", applicationIds)
          : Promise.resolve({ data: [], error: null }),
      ),
      readRows<{
        id: string;
        unit_number: string | null;
        year: number | null;
        make: string | null;
        model: string | null;
        license_plate: string | null;
        plate_expires_on: string | null;
        registration_expires_on: string | null;
        insurance_expires_on: string | null;
      }>(
        supabaseAdmin
          .from("vehicles")
          .select("id,unit_number,year,make,model,license_plate,plate_expires_on,registration_expires_on,insurance_expires_on")
          .in("id", vehicleIds),
      ),
    ]);

    const capped = <T,>(result: ReadResult<T>, limit: number): ReadResult<T> =>
      result.ok && result.rows.length >= limit ? { ok: false } : result;
    const paymentsRead = capped(payments, 5000);
    const issuesRead = capped(issues, 2000);
    const incidents: ReadResult<IncidentFact> = incidentsByVehicle.ok && incidentsByRental.ok
      && incidentsByVehicle.rows.length < 2000 && incidentsByRental.rows.length < 2000
      ? { ok: true, rows: [...incidentsByVehicle.rows, ...incidentsByRental.rows] }
      : { ok: false };
    const appById = new Map((applications.ok ? applications.rows : []).map((row) => [row.id, row]));
    const vehicleById = new Map((vehicles.ok ? vehicles.rows : []).map((row) => [row.id, row]));
    const documentsLoaded = applications.ok && vehicles.ok;

    const rows = buildActiveRentalRows({
      today,
      rentals: list.map((rental) => {
        const app = rental.application_id ? appById.get(rental.application_id) : undefined;
        const vehicle = vehicleById.get(rental.vehicle_id);
        const name = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ");
        const vehicleLabel = [
          vehicle?.unit_number ? `Unit ${vehicle.unit_number}` : null,
          name || null,
          vehicle?.license_plate || null,
        ].filter(Boolean).join(" · ") || "Vehicle";
        return {
          id: rental.id,
          driverId: rental.driver_id,
          driverName: app?.full_name?.trim() || "Driver",
          applicationId: rental.application_id,
          vehicleId: rental.vehicle_id,
          vehicleLabel,
          startDate: rental.start_date,
          weeklyRate: rental.weekly_rate == null ? null : Number(rental.weekly_rate),
          nextPaymentDue: rental.next_payment_due,
        };
      }),
      payments: paymentsRead,
      issues: issuesRead,
      incidents,
      documentDates: documentsLoaded
        ? {
            ok: true,
            rows: list.map((rental) => {
              const app = rental.application_id ? appById.get(rental.application_id) : undefined;
              const vehicle = vehicleById.get(rental.vehicle_id);
              return {
                rentalId: rental.id,
                dates: [
                  app?.license_expiration,
                  app?.insurance_expires_on,
                  vehicle?.plate_expires_on,
                  vehicle?.registration_expires_on,
                  vehicle?.insurance_expires_on,
                ],
              };
            }),
          }
        : { ok: false },
    });

    return {
      rows,
      today,
      paymentsLoaded: paymentsRead.ok,
      issuesLoaded: issuesRead.ok,
      incidentsLoaded: incidents.ok,
      documentsLoaded,
    };
  });
