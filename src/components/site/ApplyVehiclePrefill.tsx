import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PUBLIC_APPLY_VEHICLE_COLUMNS,
  presentPreferredVehicle,
  rememberPreferredVehicle,
  storedPreferredVehicle,
  type PreferredVehicle,
} from "@/lib/apply-vehicle-prefill";

/**
 * Confirms the id against vehicles_public, then shows it. Any other id
 * renders nothing.
 */
export function ApplyVehiclePrefill({
  vehicleId,
  source,
}: {
  vehicleId?: string;
  source: "search" | "session";
}) {
  const [vehicle, setVehicle] = useState<PreferredVehicle | null>(null);

  useEffect(() => {
    let active = true;
    const id = (source === "search" ? vehicleId : storedPreferredVehicle())?.trim() ?? "";
    if (!id) {
      setVehicle(null);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase
          .from("vehicles_public")
          .select(PUBLIC_APPLY_VEHICLE_COLUMNS)
          .eq("id", id)
          .maybeSingle();
        if (!active) return;
        const preferred = presentPreferredVehicle(
          error || !data ? null : (data as Record<string, unknown>),
          Boolean(error),
        );
        rememberPreferredVehicle(preferred?.id ?? null);
        setVehicle(preferred);
      } catch {
        if (!active) return;
        rememberPreferredVehicle(null);
        setVehicle(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [vehicleId, source]);

  if (!vehicle) return null;

  return (
    <div className="mt-6 rounded-xl border border-border bg-white px-4 py-3">
      <div className="text-sm font-medium">Preferred Vehicle</div>
      <div className="mt-1 text-base font-semibold">{vehicle.heading}</div>
      <div className="mt-1 text-sm text-muted-foreground">{vehicle.weeklyRateLabel}</div>
    </div>
  );
}
