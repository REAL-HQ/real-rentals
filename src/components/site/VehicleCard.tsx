import { Link } from "@tanstack/react-router";
import type { Tables } from "@/integrations/supabase/types";
import { DoorOpen, Car, BadgeCheck, Users, Shield, Wrench, Infinity as InfinityIcon, ArrowRight, Fuel, Zap, Leaf } from "lucide-react";
import { resolvePhotoUrl } from "@/lib/photoUrl";

type Vehicle = Tables<"vehicles">;

export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const img = resolvePhotoUrl(vehicle.photos?.[0]);
  const uber = vehicle.uber_eligibility ?? [];
  const status = vehicle.status ?? "available";
  const fuel = vehicle.fuel_type ?? "gas";
  const fuelMeta =
    fuel === "ev"
      ? { label: "Electric", Icon: Zap, cls: "bg-blue-50 text-blue-700 border-blue-200" }
      : fuel === "hybrid"
        ? { label: "Hybrid", Icon: Leaf, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
        : { label: "Gas", Icon: Fuel, cls: "bg-gray-100 text-gray-600 border-gray-200" };
  const statusMeta =
    status === "available"
      ? { label: "Available Now", color: "text-emerald-600", dot: "bg-emerald-500" }
      : status === "reserved"
        ? { label: "Reserved", color: "text-real-red", dot: "bg-real-red" }
        : { label: "Limited Availability", color: "text-amber-600", dot: "bg-amber-500" };
  return (
    <Link
      to="/fleet/$id"
      params={{ id: vehicle.id }}
      className="car-card group block rounded-2xl bg-soft p-5 cursor-pointer"
    >
      <div className="relative overflow-hidden rounded-xl bg-white aspect-[4/3] flex items-center justify-center">
        <span className={`absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${fuelMeta.cls}`}>
          <fuelMeta.Icon className="w-3 h-3" strokeWidth={2} />
          {fuelMeta.label}
        </span>
        {img ? (
          <img
            src={img}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            className="car-img w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="text-muted-foreground text-sm">No Photo</div>
        )}
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs font-medium">
        <span className={`relative inline-flex h-2 w-2 rounded-full ${statusMeta.dot}`}>
          {status === "available" && (
            <span className={`absolute inset-0 rounded-full ${statusMeta.dot} animate-ping opacity-60`} />
          )}
        </span>
        <span className={statusMeta.color}>{statusMeta.label}</span>
      </div>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-foreground leading-tight">
            {vehicle.make} {vehicle.model}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{vehicle.year}</div>
        </div>
        <div className="text-right">
          <div className="car-price text-lg font-semibold transition-colors whitespace-nowrap">
            ${Number(vehicle.weekly_rate)}/week
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-white border border-border/60 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Great For</div>
        <div className="text-[12px] font-medium text-foreground mt-0.5">Uber • Lyft • DoorDash • Instacart</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <Car className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span className="capitalize truncate">Type: {vehicle.body_type ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate">Seats: {vehicle.seats ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <DoorOpen className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate">Doors: {vehicle.doors ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <fuelMeta.Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate">
            {vehicle.miles_per_tank ? `${vehicle.miles_per_tank} miles` : fuelMeta.label}
          </span>
        </div>
        {uber.length > 0 && (
          <div className="col-span-2 flex items-start gap-2 min-w-0">
            <BadgeCheck className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">Eligibility: {uber.join(", ")}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = `/apply?vehicle=${vehicle.id}`;
        }}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-real-red text-white px-4 py-2.5 text-sm font-semibold hover:bg-real-red/90 transition active:scale-[0.98]"
      >
        Apply For This Vehicle <ArrowRight className="w-4 h-4" />
      </button>
      <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-foreground/80">
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          No Credit Check
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Insurance Options
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Maintenance Included
        </span>
        <span className="inline-flex items-center gap-1.5">
          <InfinityIcon className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Unlimited Miles
        </span>
      </div>
    </Link>
  );
}