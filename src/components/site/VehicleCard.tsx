import { Link } from "@tanstack/react-router";
import type { Tables } from "@/integrations/supabase/types";
import { Wrench, DoorOpen, Car, BadgeCheck } from "lucide-react";

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
      <div className="mt-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-foreground">
            {vehicle.make} {vehicle.model}
          </div>
        </div>
        <div className="text-right">
          <div className="car-price text-lg font-semibold transition-colors">
            ${Number(vehicle.weekly_rate)}
          </div>
          <div className="text-[11px] text-muted-foreground">per week</div>
        </div>
      </div>
      <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        {vehicle.maintenance_status && (
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-real-red" strokeWidth={1.75} />
            <span className="font-medium text-foreground">{vehicle.maintenance_status}</span>
          </div>
        )}
        {vehicle.doors != null && (
          <div className="flex items-center gap-2">
            <DoorOpen className="w-4 h-4" strokeWidth={1.75} />
            <span>Doors: {vehicle.doors}</span>
          </div>
        )}
        {vehicle.body_type && (
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4" strokeWidth={1.75} />
            <span className="capitalize">Type: {vehicle.body_type}</span>
          </div>
        )}
        {uber.length > 0 && (
          <div className="flex items-start gap-2">
            <BadgeCheck className="w-4 h-4 mt-0.5" strokeWidth={1.75} />
            <span>Uber eligibility: {uber.join(", ")}</span>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {(vehicle.badges || []).slice(0, 3).map((b) => (
          <span
            key={b}
            className="text-[10px] tracking-wide uppercase px-2 py-1 rounded-full bg-white text-muted-foreground border border-border"
          >
            {b}
          </span>
        ))}
        {vehicle.mpg ? (
          <span className="text-[10px] tracking-wide uppercase px-2 py-1 rounded-full bg-white text-muted-foreground border border-border">
            {vehicle.mpg} MPG
          </span>
        ) : null}
      </div>
    </Link>
  );
}