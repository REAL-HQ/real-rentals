import { resolveVehicleDefaults, type Explicit, type VehicleDefault, type Resolved } from "@/lib/vehicle-defaults";

/** Canonical server resolver used by every vehicle-creation path. */
export async function loadDefaultFor(bodyType: string | null | undefined): Promise<VehicleDefault | null> {
  if (!bodyType) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("vehicle_defaults" as any).select("body_type,weekly_rate,monthly_rate,deposit").eq("body_type", bodyType).maybeSingle();
  return (data as any) ?? null;
}

export async function resolveForCreate(bodyType: string | null | undefined, explicit: Explicit): Promise<Resolved> {
  return resolveVehicleDefaults(explicit, await loadDefaultFor(bodyType));
}
