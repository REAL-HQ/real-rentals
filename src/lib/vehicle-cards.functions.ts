import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { vinLast6 } from "@/lib/vehicle-label";

export type VehicleCardData = {
  id: string;
  unitNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  vinLast6: string | null;
  thumbnailPath: string | null;
};

/**
 * Read-only: the fields the shared vehicle cell shows (photo, year make model,
 * plate, VIN last 6, unit) for any vehicle id a list or profile card holds.
 * Staff only. Never returns the full VIN.
 */
export const getVehicleCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleIds: z.array(z.string().uuid()).max(200) }).parse(d))
  .handler(async ({ data, context }): Promise<VehicleCardData[]> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const ids = [...new Set(data.vehicleIds)];
    if (!ids.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadVehicleThumbnailPaths } = await import("@/lib/vehicle-thumbs.server");
    const [{ data: rows, error }, thumbs] = await Promise.all([
      supabaseAdmin.from("vehicles").select("id,unit_number,year,make,model,license_plate,vin").in("id", ids),
      loadVehicleThumbnailPaths(supabaseAdmin, ids),
    ]);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((v: any) => ({
      id: String(v.id),
      unitNumber: v.unit_number ?? null,
      year: v.year ?? null,
      make: v.make ?? null,
      model: v.model ?? null,
      plate: v.license_plate ?? null,
      vinLast6: vinLast6(v.vin) || null,
      thumbnailPath: thumbs.get(String(v.id)) ?? null,
    }));
  });
