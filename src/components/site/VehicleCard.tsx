import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  DoorOpen,
  Car,
  BadgeCheck,
  Users,
  Wrench,
  Infinity as InfinityIcon,
  ArrowRight,
  Fuel,
  Zap,
  Leaf,
  Wallet,
  Headphones,
} from "lucide-react";
import type { PublicVehicleCardModel } from "@/lib/marketing-fleet";
import { inventoryCardModel, type PublicVehicle } from "@/lib/public-vehicle-card";

/**
 * One merchandising card.
 *
 * It renders a `PublicVehicleCardModel` and nothing else. That model comes
 * either from the marketing catalog (a representative vehicle type) or from
 * live inventory (one real unit). The card does not know which, and the two
 * are never conflated upstream: a catalog entry has a slug, an inventory row
 * has a `vehicles.id`, and only the latter ever reaches a /fleet/$id route.
 */
export function VehicleCard({ model }: { model: PublicVehicleCardModel }) {
  // Some assets are served by the host rather than bundled. A broken-image
  // icon on a paid landing page is worse than no image, so a failed load
  // falls back to a neutral tile instead.
  const [imageFailed, setImageFailed] = useState(false);
  // A real figure gets the large price treatment. "Rate confirmed on your
  // call" is not a price and must not sit in the price slot at price size —
  // it collides with the title and reads like one.
  const hasRate = model.priceLabel.includes("$");
  const fuelMeta =
    model.fuel === "ev"
      ? { label: "Electric", Icon: Zap, cls: "bg-blue-50 text-blue-700 border-blue-200" }
      : model.fuel === "hybrid"
        ? { label: "Hybrid", Icon: Leaf, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
        : { label: "Gas", Icon: Fuel, cls: "bg-gray-100 text-gray-600 border-gray-200" };

  const body = (
    <>
      <div className="relative overflow-hidden rounded-xl bg-white aspect-[4/3] flex items-center justify-center">
        {model.kind === "inventory" && (
          <span
            className={`absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${fuelMeta.cls}`}
          >
            <fuelMeta.Icon className="w-3 h-3" strokeWidth={2} />
            {fuelMeta.label}
          </span>
        )}
        {/* Only rendered when inventory proves it. A representative type is
            never "in stock" — see marketing-fleet.ts. */}
        {model.availabilityNote && (
          <span className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <BadgeCheck className="w-3 h-3" strokeWidth={2} />
            {model.availabilityNote}
          </span>
        )}
        {model.image && !imageFailed ? (
          <img
            src={model.image}
            alt={model.subtitle ? `${model.title} — ${model.subtitle}` : model.title}
            className="car-img w-full h-full object-cover"
            loading="lazy"
            onError={() => setImageFailed(true)}
            // The page is server rendered, so an image can finish failing
            // before React hydrates and there is no error event left to
            // catch. A mounted <img> that is complete with no intrinsic
            // width is a load that already failed.
            ref={(el) => {
              if (el && el.complete && el.naturalWidth === 0) setImageFailed(true);
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Car className="w-8 h-8" strokeWidth={1.5} />
            <span className="text-sm font-medium">{model.bodyTypeLabel}</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-foreground leading-tight">{model.title}</div>
          {model.subtitle && (
            <div className="text-[12px] text-muted-foreground leading-tight mt-0.5">
              {model.subtitle}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div
            className={
              hasRate
                ? "car-price text-lg font-semibold transition-colors whitespace-nowrap"
                : "text-[11px] leading-snug text-muted-foreground max-w-[6.5rem]"
            }
          >
            {model.priceLabel}
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-white border border-border/60 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Great For</div>
        <div className="text-[12px] font-medium text-foreground mt-0.5">{model.greatFor}</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-muted-foreground">
        {model.kind === "inventory" && (
          <div className="flex items-center gap-2 min-w-0">
            <Car className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            <span className="capitalize truncate">Type: {model.bodyTypeLabel}</span>
          </div>
        )}
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate">Seats: {model.seatsLabel}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <DoorOpen className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate">Doors: {model.doorsLabel}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <fuelMeta.Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{model.rangeLabel ?? fuelMeta.label}</span>
        </div>
        {model.eligibility && (
          <div className="col-span-2 flex items-start gap-2 min-w-0">
            <BadgeCheck className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">Eligibility: {model.eligibility}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = model.ctaHref;
        }}
        // min-h-11 = 44px: the minimum comfortable touch target, and this is
        // the one control the whole marketing surface exists to get pressed.
        className="mt-4 w-full min-h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-real-red text-white px-4 py-2.5 text-sm font-semibold hover:bg-real-red/90 transition active:scale-[0.98]"
      >
        Check Availability <ArrowRight className="w-4 h-4" />
      </button>
      <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-foreground/80">
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          No Credit Check
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          No Deposit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <InfinityIcon className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Unlimited Miles
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Headphones className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          24/7 Support
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Maintenance Included
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-real-red" strokeWidth={2} />
          Same Day Approval
        </span>
      </div>
    </>
  );

  const className = "car-card group block rounded-2xl bg-soft p-5 cursor-pointer";

  // A real unit links to its own page. A catalog type has no page of its own
  // and must never fabricate one, so it links to /fleet pre-filtered to its
  // category — a destination that always exists.
  if (model.href.kind === "vehicle") {
    return (
      <Link to="/fleet/$id" params={{ id: model.href.id }} className={className}>
        {body}
      </Link>
    );
  }
  if (model.href.kind === "apply") {
    return (
      <Link to="/apply" search={{ vehicle_type: model.href.type }} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <Link to="/fleet" search={{ type: model.href.type }} className={className}>
      {body}
    </Link>
  );
}

/**
 * Convenience wrapper for the live-inventory call sites. Returns null for a
 * row the view could not fully describe, exactly as before.
 */
export function InventoryVehicleCard({ vehicle }: { vehicle: PublicVehicle }) {
  const model = inventoryCardModel(vehicle);
  if (!model) return null;
  return <VehicleCard model={model} />;
}
