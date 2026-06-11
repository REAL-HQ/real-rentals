import { Link } from "@tanstack/react-router";
import type { Tables } from "@/integrations/supabase/types";
import { DoorOpen, Car, BadgeCheck, Shield, Wrench, Infinity as InfinityIcon } from "lucide-react";

type Vehicle = Tables<"vehicles">;

export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const img = vehicle.photos?.[0];
  const uber = vehicle.uber_eligibility ?? [];
  return (
    <Link
      to="/fleet/$id"
      params={{ id: vehicle.id }}
      className="car-card group block rounded-2xl bg-soft p-5 cursor-pointer"
    >
      <div className="overflow-hidden rounded-xl bg-white aspect-[4/3] flex items-center justify-center">
        {img ? (
          <img
            src={img}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            className="car-img w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="text-muted-foreground text-sm">No photo</div>
        )}
      </div>
      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="text-lg font-semibold text-foreground">
          {vehicle.make} {vehicle.model}
        </div>
        <div className="car-price text-lg font-semibold transition-colors whitespace-nowrap">
          ${Number(vehicle.weekly_rate)}/week
        </div>
      </div>
      <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        {vehicle.body_type && (
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4" strokeWidth={1.75} />
            <span className="capitalize">Type: {vehicle.body_type}</span>
          </div>
        )}
        {vehicle.doors != null && (
          <div className="flex items-center gap-2">
            <DoorOpen className="w-4 h-4" strokeWidth={1.75} />
            <span>Doors: {vehicle.doors}</span>
          </div>
        )}
        {uber.length > 0 && (
          <div className="flex items-start gap-2">
            <BadgeCheck className="w-4 h-4 mt-0.5" strokeWidth={1.75} />
            <span>Eligibility: {uber.join(", ")}</span>
          </div>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-foreground/80">
        <span className="inline-flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Insurance Included
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Maintenance Included
        </span>
        <span className="inline-flex items-center gap-1.5">
          <InfinityIcon className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Unlimited Miles
        </span>
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Uber/Lyft Eligible
        </span>
      </div>
    </Link>
  );
}