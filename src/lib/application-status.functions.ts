import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";
import {
  applicationStatusEventFromAudit,
  authoritativeActiveApplicationIds,
  openRentalApplicationIds,
  type ActivePaymentRow,
  type ActiveRentalRow,
  type ActiveVehicleRow,
  type ApplicationStatusEvent,
} from "@/lib/application-status";

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
  /** Meets the full Active definition. The Active filter uses this set. */
  authoritativeIds: string[];
  /** A rentals row is still status active. Used only to tell a stored Active from a missing rental. */
  openRentalIds: string[];
};

/**
 * Staff read of Active evidence. Selects existing rows. Does not insert,
 * and does not read Stripe subscription status.
 */
export const listDriverActiveSets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverActiveSets> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rentalRows, error } = await supabaseAdmin
      .from("rentals")
      .select("id,application_id,status,vehicle_id,pickup_reading_id")
      .eq("status", "active");
    if (error) throw new Error(error.message);
    const rentals = (rentalRows ?? []) as ActiveRentalRow[];
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
      authoritativeIds: authoritativeActiveApplicationIds({ rentals, vehicles, payments }),
      openRentalIds: openRentalApplicationIds(rentals),
    };
  });
