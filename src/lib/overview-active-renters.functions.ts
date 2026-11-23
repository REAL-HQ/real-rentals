import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildActiveRentalRows, dateOnly, etDateISO, type PaymentFact, type ReadResult } from "@/lib/active-rentals";
import {
  OVERVIEW_OPEN_SWAP_STATUSES,
  summarizeActiveRenters,
  type ActiveRenterFact,
  type ActiveRentersSummary,
} from "@/lib/overview-active-renters";
import { tierAllows } from "@/lib/roles";
import { vinLast6 } from "@/lib/vehicle-label";

// Overview → Active Renters, expanded.
//
// The collapsed count stays on the rental read Overview already does. This
// read adds the detail: standing from buildActiveRentalRows (the Bookings >
// Active path), weekly rate and autopay from the rental row, return dates
// from end_date, and open swaps. Names are applications.full_name. The
// vehicle line is the plate and the VIN last 6.
//
// Payment rows are Manager and above. A Coordinator can read who has which
// car, and the card then says Payment Standing is Unavailable instead of
// inventing Current / Due Today / Overdue from the stored date.

const RENTAL_LIMIT = 500;
const PAYMENT_LIMIT = 5000;
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

export const getOverviewActiveRenters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<ActiveRentersSummary> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const money = tierAllows(actor.tier, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = etDateISO();

    const { data: rentals, error } = await supabaseAdmin
      .from("rentals")
      .select("id,application_id,vehicle_id,start_date,weekly_rate,next_payment_due,end_date,autopay_active")
      .eq("status", "active")
      .order("start_date", { ascending: true })
      .limit(RENTAL_LIMIT);
    if (error) throw new Error(error.message);
    const list = rentals ?? [];
    if (!list.length) {
      return summarizeActiveRenters({ today, renters: [], paymentsLoaded: true, openSwaps: 0, rentalsCapped: false });
    }

    const rentalIds = ids(list.map((rental) => rental.id));
    const applicationIds = ids(list.map((rental) => rental.application_id));
    const vehicleIds = ids(list.map((rental) => rental.vehicle_id));

    const namesQuery = applicationIds.length
      ? supabaseAdmin.from("applications").select("id,full_name").in("id", applicationIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[], error: null });
    const vehiclesQuery = vehicleIds.length
      ? supabaseAdmin.from("vehicles").select("id,license_plate,vin").in("id", vehicleIds)
      : Promise.resolve({ data: [] as { id: string; license_plate: string | null; vin: string | null }[], error: null });
    // The swap table is not in the generated Database types. A missing table
    // (swap not installed) is an unavailable count, not a failed card.
    const swapsQuery = (supabaseAdmin as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          in: (column: string, values: readonly string[]) => {
            in: (column: string, values: readonly string[]) => {
              limit: (count: number) => Promise<{ data: { rental_id: string | null }[] | null; error: { message: string } | null }>;
            };
          };
        };
      };
    })
      .from("rental_vehicle_swaps")
      .select("rental_id")
      .in("rental_id", rentalIds)
      .in("status", OVERVIEW_OPEN_SWAP_STATUSES)
      .limit(RENTAL_LIMIT);

    const paymentsQuery = money
      ? supabaseAdmin
          .from("payments")
          .select("rental_id,type,reason,notes,amount,status,paid_date,due_date,created_at,stripe_invoice_id,stripe_payment_intent_id")
          .in("rental_id", rentalIds)
          .order("created_at", { ascending: false })
          .limit(PAYMENT_LIMIT)
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
              type: row.type,
              reason: row.reason,
              notes: row.notes,
              amount: row.amount,
            })),
          }))
      : null;

    const [names, vehicles, swaps, payments, dailyPlans] = await Promise.all([
      readRows<{ id: string; full_name: string | null }>(namesQuery),
      readRows<{ id: string; license_plate: string | null; vin: string | null }>(vehiclesQuery),
      readRows<{ rental_id: string | null }>(swapsQuery),
      paymentsQuery ? readRows<PaymentFact>(paymentsQuery) : Promise.resolve(null),
      money
        ? import("@/lib/daily-rent-plans.server").then((mod) => mod.loadDailyRentPlans(supabaseAdmin))
        : Promise.resolve(null),
    ]);

    const paymentsLoaded = money && payments != null && payments.ok && payments.rows.length < PAYMENT_LIMIT;
    const nameById = new Map((names.ok ? names.rows : []).map((row) => [row.id, row.full_name?.trim() ?? ""]));
    const vehicleById = new Map((vehicles.ok ? vehicles.rows : []).map((row) => [row.id, row]));

    const standing = new Map<string, { nextDue: string | null; overdueDays: number | null }>();
    if (paymentsLoaded && payments?.ok) {
      const rows = buildActiveRentalRows({
        today,
        rentals: list.map((rental) => ({
          id: rental.id,
          driverId: rental.id,
          driverName: rental.application_id ? nameById.get(rental.application_id) || "Driver" : "Driver",
          applicationId: rental.application_id,
          vehicleId: rental.vehicle_id,
          vehicleLabel: "Vehicle",
          startDate: rental.start_date,
          weeklyRate: rental.weekly_rate == null ? null : Number(rental.weekly_rate),
          nextPaymentDue: rental.next_payment_due,
        })),
        payments,
        dailyPlans: dailyPlans ?? new Map(),
        issues: { ok: true, rows: [] },
        incidents: { ok: true, rows: [] },
        documentDates: { ok: true, rows: [] },
      });
      for (const row of rows) standing.set(row.id, { nextDue: row.nextPaymentDue, overdueDays: row.overdueDays });
    }

    const renters: ActiveRenterFact[] = list.map((rental) => {
      const vehicle = rental.vehicle_id ? vehicleById.get(rental.vehicle_id) : undefined;
      const owed = standing.get(rental.id);
      return {
        id: rental.id,
        name: rental.application_id ? nameById.get(rental.application_id) ?? "" : "",
        plate: vehicle?.license_plate ?? null,
        vinLast6: vinLast6(vehicle?.vin) || null,
        weeklyRate: rental.weekly_rate == null ? null : Number(rental.weekly_rate),
        autopayOn: rental.autopay_active === true,
        endDate: rental.end_date,
        nextDue: owed ? owed.nextDue : dateOnly(rental.next_payment_due),
        overdueDays: owed ? owed.overdueDays : null,
      };
    });

    return summarizeActiveRenters({
      today,
      renters,
      paymentsLoaded,
      openSwaps: swaps.ok ? swaps.rows.length : null,
      rentalsCapped: list.length >= RENTAL_LIMIT,
    });
  });
