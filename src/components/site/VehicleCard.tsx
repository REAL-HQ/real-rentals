import { Link } from "@tanstack/react-router";
import type { Tables } from "@/integrations/supabase/types";
import { DoorOpen, Car, BadgeCheck, Users, Shield, Wrench, Infinity as InfinityIcon, TrendingUp, ArrowRight, Check } from "lucide-react";

type Vehicle = Tables<"vehicles">;

export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const img = vehicle.photos?.[0];
  const uber = vehicle.uber_eligibility ?? [];
  const status = vehicle.status ?? "available";
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
      <div className="overflow-hidden rounded-xl bg-white aspect-[4/3] flex items-center justify-center">
        {img ? (
          <img
            src={img}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            className="car-img w-full h-full object-contain p-3"
            loading="lazy"
          />
        ) : (
          <div className="text-muted-foreground text-sm">No photo</div>
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
      <div className="mt-3 rounded-lg bg-white border border-border/60 px-3 py-2 flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-emerald-600" strokeWidth={2.25} />
        <div className="text-[11px] leading-tight">
          <span className="text-muted-foreground">Typical Driver Earnings: </span>
          <span className="font-semibold text-foreground">$1,000–$1,500/wk*</span>
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
        {vehicle.seats != null && (
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" strokeWidth={1.75} />
            <span>Seats: {vehicle.seats}</span>
          </div>
        )}
        {uber.length > 0 && (
          <div className="flex items-start gap-2">
            <BadgeCheck className="w-4 h-4 mt-0.5" strokeWidth={1.75} />
            <span>Eligibility: {uber.join(", ")}</span>
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