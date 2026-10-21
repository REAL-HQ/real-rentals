import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Wrench, BadgeCheck, Check, Infinity as InfinityIcon, Zap, Wallet, Headphones } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { InventoryVehicleCard, VehicleCard } from "@/components/site/VehicleCard";
import { PublicAvailabilityBadge, ShowAvailableOnly } from "@/components/site/PublicAvailability";
import { inventoryCardModel } from "@/lib/public-vehicle-card";
import { PUBLIC_AVAILABILITY_ENABLED, isAvailableNow, publicAvailability } from "@/lib/public-availability";
import { FLEET_FILTERS_ENABLED } from "@/lib/fleet-filters";
import { FadeUp } from "@/components/site/FadeUp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CATEGORY_LABEL,
  MARKETING_CATEGORIES,
  catalogCardModel,
  isMarketingCategory,
  marketingFleetByCategory,
  type MarketingCategory,
} from "@/lib/marketing-fleet";

// fleet-search-start
const FLEET_SORTS = ["price_asc", "price_desc", "newest"] as const;

type FleetSort = (typeof FLEET_SORTS)[number];

type FleetFilterState = {
  make: string;
  minRate: number | null;
  maxRate: number | null;
  uberOnly: boolean;
  availableOnly: boolean;
  sort: FleetSort;
};

function cleanRate(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readFleetSearch(search: Record<string, unknown>): FleetFilterState {
  const make =
    typeof search.make === "string" && search.make.trim() !== "" && search.make !== "all"
      ? search.make.trim().slice(0, 40)
      : "all";
  const sort = FLEET_SORTS.find((item) => item === search.sort) ?? "price_asc";
  return {
    make,
    minRate: cleanRate(search.min),
    maxRate: cleanRate(search.max),
    uberOnly: search.uber === "1" || search.uber === 1 || search.uber === true,
    availableOnly: !(search.available === "0" || search.available === 0 || search.available === false),
    sort,
  };
}

function fleetSearchParams(state: FleetFilterState): {
  make?: string;
  min?: number;
  max?: number;
  uber?: boolean;
  available?: boolean;
  sort?: string;
} {
  return {
    ...(state.make !== "all" ? { make: state.make } : {}),
    ...(state.minRate !== null ? { min: state.minRate } : {}),
    ...(state.maxRate !== null ? { max: state.maxRate } : {}),
    ...(state.uberOnly ? { uber: true } : {}),
    ...(!state.availableOnly ? { available: false } : {}),
    ...(state.sort !== "price_asc" ? { sort: state.sort } : {}),
  };
}
// fleet-search-end

type ApplyFleetFilters = <T extends {
  id?: string | null;
  make?: string | null;
  body_type?: string | null;
  weekly_rate?: number | null;
  year?: number | null;
  status?: string | null;
  uber_eligibility?: string[] | null;
}>(rows: T[], state: FleetFilterState) => T[];

function FleetFiltersGate(props: {
  makes: string[];
  value: FleetFilterState;
  onChange: (next: FleetFilterState) => void;
}) {
  const [Bar, setBar] = useState<ComponentType<typeof props> | null>(null);
  useEffect(() => {
    if (FLEET_FILTERS_ENABLED !== true) return;
    let cancelled = false;
    import("@/components/site/FleetFiltersBar").then((mod) => {
      if (!cancelled) setBar(() => mod.FleetFiltersBar);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (FLEET_FILTERS_ENABLED !== true || !Bar) return null;
  return <Bar {...props} />;
}

export const Route = createFileRoute("/fleet/")({
  // `type` is an entry point, not a view state. A marketing catalog card
  // links here with the category it merchandises so the link lands on
  // something relevant instead of the unfiltered list. It seeds the filter on
  // arrival and the chips take over from there — deliberately not two owners
  // of one piece of state.
  validateSearch: (s: Record<string, unknown>): {
    type?: MarketingCategory;
    make?: string;
    min?: number;
    max?: number;
    uber?: boolean;
    available?: boolean;
    sort?: string;
  } => {
    const base = isMarketingCategory(s.type) ? { type: s.type } : {};
    // Inlined so this route option does not reference the filter helpers.
    // Referencing them here makes the dev server request a shared route chunk.
    const filtersOn: boolean = false as boolean;
    if (filtersOn !== true) return base;
    const extra: { make?: string; min?: number; max?: number; uber?: boolean; available?: boolean; sort?: string } = {};
    if (typeof s.make === "string" && s.make.trim() !== "" && s.make !== "all") extra.make = s.make.trim().slice(0, 40);
    const rate = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value);
      return undefined;
    };
    const min = rate(s.min);
    const max = rate(s.max);
    if (min !== undefined) extra.min = min;
    if (max !== undefined) extra.max = max;
    if (s.uber === "1" || s.uber === 1 || s.uber === true) extra.uber = true;
    if (s.available === "0" || s.available === 0 || s.available === false) extra.available = false;
    if (s.sort === "price_desc" || s.sort === "newest") extra.sort = s.sort;
    return { ...base, ...extra };
  },
  head: () => ({
    meta: [
      { title: "The Fleet — REAL RENTALS" },
      { name: "description", content: "Browse rideshare-ready vehicles. Filter by make, body type, and price. From $350/week." },
      { property: "og:title", content: "The Fleet — REAL RENTALS" },
      { property: "og:description", content: "Every car ready for Uber, Lyft, DoorDash, Instacart, and Amazon Flex." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://drivereal.com/fleet" }],
  }),
  component: FleetPage,
});

function FleetAvailabilityCar({ vehicle }: { vehicle: Tables<"vehicles_public"> }) {
  const model = inventoryCardModel(vehicle);
  if (!model) return null;
  return (
    <div className="space-y-3">
      <PublicAvailabilityBadge availability={publicAvailability(vehicle)} />
      <VehicleCard model={{ ...model, availabilityNote: null }} />
    </div>
  );
}

function FleetPage() {
  const search = Route.useSearch();
  const { type } = search;
  const navigate = useNavigate();
  const fleetFilters = readFleetSearch(search);
  const [vehicles, setVehicles] = useState<Tables<"vehicles_public">[]>([]);
  const [filterRows, setFilterRows] = useState<ApplyFleetFilters | null>(null);
  const [make, setMake] = useState("all");
  const [categories, setCategories] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MARKETING_CATEGORIES.map((c) => [c, type ? c === type : true])),
  );
  const [onlyAvail, setOnlyAvail] = useState(true);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (FLEET_FILTERS_ENABLED === true) return;
    let cancelled = false;
    // A hard cap on how long this page is allowed to show nothing.
    //
    // try/catch/finally covers a query that fails. It does not cover one that
    // hangs — an unreachable or very slow backend leaves the fetch pending for
    // tens of seconds, and gating the catalog on it meant a merchandising page
    // with no merchandise for that whole time. That is the original conversion
    // bug wearing a different hat, so the fallback is never gated on the
    // network for longer than this.
    const grace = setTimeout(() => {
      if (!cancelled) setLoaded(true);
    }, 2500);
    (async () => {
      try {
        const { data } = await supabase
          .from("vehicles_public")
          .select("*")
          .neq("status", "retired")
          .order("weekly_rate", { ascending: true });
        if (!cancelled) setVehicles(data || []);
      } catch {
        // Unreachable backend. Not a page failure: the catalog below still
        // has something to show, which is the entire point of having one.
      } finally {
        // Always, on every path. Gating the fallback on a promise that can
        // reject is how the page ends up blank — the exact failure this work
        // exists to remove.
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(grace);
    };
  }, []);

  useEffect(() => {
    if (FLEET_FILTERS_ENABLED !== true) return;
    let cancelled = false;
    const grace = setTimeout(() => {
      if (!cancelled) setLoaded(true);
    }, 2500);
    (async () => {
      try {
        const mod = await import("@/lib/fleet-filters");
        if (!cancelled) setFilterRows(() => mod.applyFleetFilters);
        const { data } = await supabase
          .from("vehicles_public")
          .select(mod.FLEET_LISTING_COLUMNS)
          .neq("status", "retired")
          .order("weekly_rate", { ascending: true });
        if (!cancelled) setVehicles((data || []) as Tables<"vehicles_public">[]);
      } catch {
        // Same fallback as the flag-off fetch: the catalog still has something to show.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(grace);
    };
  }, []);

  // A later /fleet?type=... navigation must move the chips even if the route
  // component is still mounted from a previous visit — otherwise the link
  // changes the URL and nothing on screen.
  useEffect(() => {
    if (!type) return;
    setCategories(Object.fromEntries(MARKETING_CATEGORIES.map((c) => [c, c === type])));
  }, [type]);

  const makes = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.make).filter((m): m is string => !!m))).sort(),
    [vehicles]
  );

  const rows = FLEET_FILTERS_ENABLED === true
    ? (filterRows ? filterRows(vehicles, fleetFilters) : []).filter((v) => categories[v.body_type ?? "sedan"])
    : vehicles.filter((v) => {
        const cat = v.body_type ?? "sedan";
        return (
          (make === "all" || v.make === make) &&
          categories[cat] &&
          (!onlyAvail || v.status === "available")
        );
      });
  const filtered = rows.filter((v) => !(PUBLIC_AVAILABILITY_ENABLED && availableOnly && !isAvailableNow(v)));

  const toggleCat = (k: string) =>
    setCategories((c) => ({ ...c, [k]: !c[k] }));

  // Shown only when live inventory has nothing to show. The catalog never
  // joins the inventory grid and never affects the count above it — it is a
  // separate section with its own heading, so a visitor is never told a
  // representative type is a car sitting on the lot.
  const catalogFallback = useMemo(() => {
    const picked = MARKETING_CATEGORIES.filter((c) => categories[c]);
    const cats = picked.length > 0 ? picked : MARKETING_CATEGORIES;
    // "apply", not "category": a category link from the fleet page points at
    // the fleet page. See catalogCardModel.
    return cats
      .flatMap((c) => marketingFleetByCategory(c))
      .map((v) => catalogCardModel(v, "apply"));
  }, [categories]);

  return (
    <SiteLayout>
      <section className="container-real pt-16 md:pt-20 pb-4">
        <FadeUp>
          <h1 className="text-2xl md:text-3xl font-semibold">Available Vehicles</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs md:text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />Uber/Lyft Eligible</span>
            <span className="inline-flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-real-red" strokeWidth={2.5} />No Credit Check</span>
            <span className="inline-flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />No Deposit</span>
            <span className="inline-flex items-center gap-1.5"><InfinityIcon className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />Unlimited Miles</span>
            <span className="inline-flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />Maintenance Included</span>
            <span className="inline-flex items-center gap-1.5"><Headphones className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />24/7 Driver Support</span>
            <span className="inline-flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />Same Day Approval</span>
          </div>
        </FadeUp>
      </section>

      <section className="container-real">
        <FadeUp>
          {FLEET_FILTERS_ENABLED === true ? (
            <div className="flex flex-col gap-4">
              <FleetFiltersGate
                makes={makes}
                value={fleetFilters}
                onChange={(next) => {
                  if (FLEET_FILTERS_ENABLED !== true) return;
                  navigate({
                    to: "/fleet",
                    search: (prev) => ({
                      ...(prev.type ? { type: prev.type } : {}),
                      ...fleetSearchParams(next),
                    }),
                  });
                }}
              />
              <div className="rounded-2xl bg-soft p-5">
                <div className="text-sm mb-2">Category</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { k: "sedan", label: CATEGORY_LABEL.sedan, tagline: "Great MPG · Uber & Lyft" },
                    { k: "suv", label: CATEGORY_LABEL.suv, tagline: "More Room · Comfort Rides" },
                    { k: "xl", label: CATEGORY_LABEL.xl, tagline: "6+ Seats · UberXL & Lyft XL" },
                  ].map((c) => (
                    <button
                      key={c.k}
                      type="button"
                      onClick={() => toggleCat(c.k)}
                      className={`min-h-11 text-left px-4 py-2 rounded-lg text-sm border transition ${
                        categories[c.k]
                          ? "bg-real-red text-white border-real-red"
                          : "bg-white text-foreground border-border hover:border-foreground/40"
                      }`}
                    >
                      <span className="block font-medium">{c.label}</span>
                      <span className="block text-[10px] opacity-90 leading-tight">{c.tagline}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
          <div className="rounded-2xl bg-soft p-5 flex flex-wrap items-center gap-5">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Make</label>
              <Select value={make} onValueChange={setMake}>
                <SelectTrigger className="h-9 w-36 rounded-lg bg-white text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {makes.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col flex-1 min-w-[260px]">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Category</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { k: "sedan", label: CATEGORY_LABEL.sedan, tagline: "Great MPG · Uber & Lyft" },
                  { k: "suv", label: CATEGORY_LABEL.suv, tagline: "More Room · Comfort Rides" },
                  { k: "xl", label: CATEGORY_LABEL.xl, tagline: "6+ Seats · UberXL & Lyft XL" },
                ].map((c) => (
                  <button
                    key={c.k}
                    type="button"
                    onClick={() => toggleCat(c.k)}
                    className={`text-left px-4 py-2 rounded-lg text-sm border transition ${
                      categories[c.k]
                        ? "bg-real-red text-white border-real-red"
                        : "bg-white text-foreground border-border hover:border-foreground/40"
                    }`}
                  >
                    <span className="block font-medium">{c.label}</span>
                    <span className="block text-[10px] opacity-90 leading-tight">{c.tagline}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* Scopes the list of REAL cars; it can never empty the page,
                because the catalog below is not inventory and is not filtered
                by availability. Unchecking it widens what is shown — it is not
                a way to make the marketing fleet disappear. */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="inline-flex items-center gap-2">
                <input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} className="accent-[#D03020]" />
                Available Now Only
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                Filters cars on the lot. Vehicle types below always show.
              </span>
            </label>
            {PUBLIC_AVAILABILITY_ENABLED ? (
              <ShowAvailableOnly pressed={availableOnly} onPressed={setAvailableOnly} />
            ) : null}
          </div>
          )}
        </FadeUp>
      </section>

      <section className="container-real py-8 md:py-10">
        <FadeUp className="mb-6 flex items-end justify-between gap-4">
          <div className="text-sm md:text-base font-medium">
            {/* "Available" only when the filter actually restricts to available
                units. With the box unchecked this list includes rented and
                down vehicles, and calling them available was a false claim. */}
            Showing <span className="font-semibold">{filtered.length}</span>
            {FLEET_FILTERS_ENABLED === true ? (fleetFilters.availableOnly ? " Available " : " ") : (onlyAvail ? " Available " : " ")}
            {filtered.length === 1 ? "Vehicle" : "Vehicles"}
          </div>
        </FadeUp>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
          {filtered.map((v, i) => (
            <FadeUp key={v.id} delay={i * 40}>
              {PUBLIC_AVAILABILITY_ENABLED ? <FleetAvailabilityCar vehicle={v} /> : <InventoryVehicleCard vehicle={v} />}
            </FadeUp>
          ))}
        </div>
        {(!loaded || (FLEET_FILTERS_ENABLED === true && !filterRows)) && filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">Loading the fleet…</div>
        )}
        {loaded && filtered.length === 0 && (FLEET_FILTERS_ENABLED !== true || !!filterRows) && (
          <div className="mt-2">
            <FadeUp className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl md:text-3xl">Vehicles Built For Gig Work.</h2>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                These are the types of vehicles we regularly offer. Availability changes daily
                — start your application and we will confirm your car on a quick call.
              </p>
            </FadeUp>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
              {catalogFallback.map((model, i) => (
                <FadeUp key={model.key} delay={i * 40}>
                  <VehicleCard model={model} />
                </FadeUp>
              ))}
            </div>
          </div>
        )}
      </section>
    </SiteLayout>
  );
}