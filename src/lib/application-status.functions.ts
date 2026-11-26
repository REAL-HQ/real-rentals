import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";
import { RECORD_RENTAL_CONTRACT_ENABLED } from "@/lib/record-rental-contract";
import {
  activeFilterApplicationIds,
  applicationStatusEventFromAudit,
  openRentalApplicationIds,
  type ActivePaymentRow,
  type ActiveRentalRow,
  type ActiveVehicleRow,
  type ApplicationStatusEvent,
} from "@/lib/application-status";
import { PHASE_STATUSES, bookingOutcomeApplicationIds } from "@/lib/bookings-list";

/**
 * Who closed or reopened this application.
 *
 * Read from audit_log. There is no closure column and no second history
 * table. The browser still has no INSERT on audit_log.
 */
export const getApplicationStatusHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ApplicationStatusEvent[]> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("audit_log")
      .select("created_at,actor_email,action,metadata")
      .eq("entity_type", "application")
      .eq("entity_id", data.applicationId)
      .in("action", ["application.closed", "application.reopened"])
      .order("created_at", { ascending: false })
      .limit(50);
    type LogRow = { created_at: unknown; actor_email: unknown; action: unknown; metadata: unknown };
    return ((rows ?? []) as unknown as LogRow[])
      .map((row) => applicationStatusEventFromAudit(row))
      .filter((row): row is ApplicationStatusEvent => row != null && row.at !== "");
  });

export type DriverActiveSets = {
  /** Active filter ids. Ongoing rentals while Record Rental is uninstalled; full evidence after. */
  authoritativeIds: string[];
  /** A rentals row is still status active. Used to tell a stored Active from a missing rental. */
  openRentalIds: string[];
  /** Applications with a rental on the Bookings Completed tab. */
  completedBookingIds: string[];
  /** Applications with a rental on the Bookings Cancelled tab. */
  cancelledBookingIds: string[];
  /** The outcome read failed. Counts stay unknown instead of looking like zero. */
  bookingOutcomesFailed: boolean;
};

const BOOKING_OUTCOME_STATUSES = [...PHASE_STATUSES.completed, ...PHASE_STATUSES.cancelled];

/** Completed and cancelled rentals already stored. Paged so a long history is not cut at 1000. */
async function readBookingOutcomes(admin: { from: (table: string) => any }): Promise<{ completed: string[]; cancelled: string[] }> {
  const rows: { application_id: string | null; status: string | null }[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await admin
      .from("rentals")
      .select("application_id,status")
      .in("status", BOOKING_OUTCOME_STATUSES)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { application_id: string | null; status: string | null }[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return bookingOutcomeApplicationIds(rows);
}

/**
 * Staff read of Active evidence. Selects existing rows. Does not insert,
 * and does not read Stripe subscription status.
 */
export const listDriverActiveSets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverActiveSets> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [activeRead, outcomeRead] = await Promise.all([
      supabaseAdmin.from("rentals").select("id,application_id,status,vehicle_id,pickup_reading_id").eq("status", "active"),
      readBookingOutcomes(supabaseAdmin).then(
        (outcomes) => ({ outcomes, failed: false }),
        () => ({ outcomes: { completed: [] as string[], cancelled: [] as string[] }, failed: true }),
      ),
    ]);
    const { data: rentalRows, error } = activeRead;
    if (error) throw new Error(error.message);
    const rentals = (rentalRows ?? []) as ActiveRentalRow[];
    const booking = {
      completedBookingIds: outcomeRead.outcomes.completed,
      cancelledBookingIds: outcomeRead.outcomes.cancelled,
      bookingOutcomesFailed: outcomeRead.failed,
    };
    const openRentalIds = openRentalApplicationIds(rentals);
    // Pickup mileage and a collected payment are optional on the installed
    // activate_rental_tx. Existing renters stay in the filter, and a payments
    // read cannot hide them, until Record Rental contracts exist.
    const recordRentalEnabled = RECORD_RENTAL_CONTRACT_ENABLED as boolean;
    if (recordRentalEnabled !== true) {
      return {
        authoritativeIds: activeFilterApplicationIds({ rentals, recordRentalEnabled: false }),
        openRentalIds,
        ...booking,
      };
    }
    const vehicleIds = [...new Set(rentals.map((rental) => rental.vehicle_id).filter((id): id is string => !!id))];
    const rentalIds = rentals.map((rental) => rental.id);
    const [vehicleResult, paymentResult] = await Promise.all([
      vehicleIds.length
        ? supabaseAdmin.from("vehicles").select("id,status,archived_at").in("id", vehicleIds)
        : Promise.resolve({ data: [], error: null }),
      rentalIds.length
        ? supabaseAdmin
            .from("payments")
            .select("rental_id,status,type,net_collected,amount")
            .in("rental_id", rentalIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (vehicleResult.error) throw new Error(vehicleResult.error.message);
    if (paymentResult.error) throw new Error(paymentResult.error.message);
    const vehicles = (vehicleResult.data ?? []) as ActiveVehicleRow[];
    const payments = (paymentResult.data ?? []) as ActivePaymentRow[];
    return {
      authoritativeIds: activeFilterApplicationIds({
        rentals,
        vehicles,
        payments,
        recordRentalEnabled: true,
      }),
      openRentalIds,
      ...booking,
    };
  });
