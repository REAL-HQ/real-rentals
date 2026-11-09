import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertMyCarCardEnabled, buildMyCar, type MyCarCard, type MyCarVehicle } from "@/lib/my-car-card";

const previewInput = (value: unknown): { previewDriverId?: string } => {
  const id = (value as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
};

const scope = async (context: { supabase: any; userId: string }, data: { previewDriverId?: string }, section: string) =>
  (await import("@/lib/driver-preview.server")).portalScope(context, data, section);

/**
 * Read-only. The caller's client after the existing portal scope, so a
 * manager preview stays on that read. vehicles_public and the driver's own
 * rental only. Nothing here writes.
 */
export const getMyCar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => input ?? {})
  .handler(async ({ data, context }): Promise<MyCarCard | null> => {
    assertMyCarCardEnabled();
    const input = previewInput(data);
    const { supabase, userId } = await scope(context, input, "my_car");

    const rentals = await supabase
      .from("rentals")
      .select("status,start_date,weekly_rate,vehicle_id")
      .eq("driver_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    if (rentals.error) throw new Error(rentals.error.message);
    const rental = rentals.data?.[0];
    if (!rental) return null;

    let vehicle: MyCarVehicle | null = null;
    if (rental.vehicle_id) {
      const row = await supabase
        .from("vehicles_public")
        .select("year,make,model,color,photos")
        .eq("id", rental.vehicle_id)
        .maybeSingle();
      if (!row.error && row.data) vehicle = row.data as MyCarVehicle;
    }

    return buildMyCar(
      {
        status: rental.status,
        start_date: rental.start_date,
        weekly_rate: rental.weekly_rate,
      },
      vehicle,
    );
  });
