import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertPortalMyRentalEnabled,
  EMPTY_PORTAL_MY_RENTAL,
  portalMyRental,
  type MyRentalRow,
  type MyRentalVehicleRow,
  type PortalMyRentalResult,
} from "@/lib/portal-my-rental";

function previewInput(d: unknown): { previewDriverId?: string } {
  const id = (d as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
}

/**
 * The signed-in driver's active rental, for the My Rental card.
 *
 * A driver read uses their own JWT. "Drivers read own rentals" limits
 * `rentals` to `driver_id = auth.uid()`. Year, make, and model come from
 * `vehicles_public`, which authenticated users may already select. This
 * function does not open `public.vehicles` and does not use the service role.
 * Driver Preview goes through portalScope, still filtered to that one driver
 * and still only these columns. The card has no write.
 */
export const getPortalMyRental = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ context, data }): Promise<PortalMyRentalResult> => {
    assertPortalMyRentalEnabled();
    const { portalScope } = await import("@/lib/driver-preview.server");
    const { supabase, userId } = await portalScope(context, data, "my_rental");

    const { data: rental, error } = await supabase
      .from("rentals")
      .select("start_date,next_payment_due,weekly_rate,vehicle_id,status")
      .eq("driver_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Could not load your rental.");
    if (!rental) return { ...EMPTY_PORTAL_MY_RENTAL };

    let vehicle: MyRentalVehicleRow | null = null;
    if (rental.vehicle_id) {
      const { data: row } = await supabase
        .from("vehicles_public")
        .select("year,make,model")
        .eq("id", rental.vehicle_id)
        .maybeSingle();
      if (row) {
        vehicle = {
          year: (row.year as number | null) ?? null,
          make: (row.make as string | null) ?? null,
          model: (row.model as string | null) ?? null,
        };
      }
    }

    return portalMyRental(rental as MyRentalRow, vehicle);
  });
