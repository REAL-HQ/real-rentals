/**
 * Projects a real, live inventory row into the same neutral card model the
 * marketing catalog projects into.
 *
 * Kept out of marketing-fleet.ts on purpose: that module must stay free of
 * any database dependency so it cannot acquire one by accident. This one is
 * allowed to know about `vehicles_public` and storage URLs.
 */
import type { Tables } from "@/integrations/supabase/types";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import type { PublicVehicleCardModel } from "@/lib/marketing-fleet";

export type PublicVehicle = Tables<"vehicles_public">;

const FUEL_LABEL = { ev: "Electric", hybrid: "Hybrid", gas: "Gas" } as const;

/**
 * Returns null when the row cannot be shown. View columns come back nullable
 * because a view cannot promise otherwise, and without an id the card has
 * nowhere to link.
 */
export function inventoryCardModel(vehicle: PublicVehicle): PublicVehicleCardModel | null {
  if (!vehicle.id) return null;
  const raw = vehicle.fuel_type ?? "gas";
  const fuel: "gas" | "hybrid" | "ev" = raw === "ev" || raw === "hybrid" ? raw : "gas";
  const uber = vehicle.uber_eligibility ?? [];
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();

  return {
    key: `inventory:${vehicle.id}`,
    kind: "inventory",
    title: name || "Vehicle",
    subtitle: vehicle.year ? String(vehicle.year) : null,
    image: resolvePhotoUrl(vehicle.photos?.[0]),
    priceLabel:
      vehicle.weekly_rate === null || vehicle.weekly_rate === undefined
        ? "Rate confirmed on your call"
        : `$${Number(vehicle.weekly_rate)}/week`,
    greatFor: "Uber • Lyft • DoorDash • Instacart",
    bodyTypeLabel: vehicle.body_type ?? "—",
    seatsLabel: vehicle.seats ? String(vehicle.seats) : "—",
    doorsLabel: vehicle.doors ? String(vehicle.doors) : "—",
    fuel,
    rangeLabel: vehicle.miles_per_tank ? `${vehicle.miles_per_tank} miles` : null,
    eligibility: uber.length > 0 ? uber.join(", ") : null,
    // Only a real unit can be in stock, and only when the back office says so.
    availabilityNote: vehicle.status === "available" ? "Available now" : null,
    href: { kind: "vehicle", id: vehicle.id },
    ctaHref: `/apply?vehicle=${vehicle.id}`,
  };
}

export { FUEL_LABEL };
