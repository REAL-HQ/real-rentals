import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Wrench, BadgeCheck, Check, Infinity as InfinityIcon, Zap, Wallet, Headphones } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { InventoryVehicleCard, VehicleCard } from "@/components/site/VehicleCard";
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

export const Route = createFileRoute("/fleet/")({
  // `type` is an entry point, not a view state. A marketing catalog card
  // links here with the category it merchandises so the link lands on
  // something relevant instead of the unfiltered list. It seeds the filter on
  // arrival and the chips take over from there — deliberately not two owners
  // of one piece of state.
  validateSearch: (s: Record<string, unknown>): { type?: MarketingCategory } =>
    isMarketingCategory(s.type) ? { type: s.type } : {},
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

function FleetPage() {
  const { type } = Route.useSearch();
  const [vehicles, setVehicles] = useState<Tables<"vehicles_public">[]>([]);
  const [make, setMake] = useState("all");
  const [categories, setCategories] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      MARKETING_CATEGORIES.map((c) => [c, type ? c === type : true]),
    ),
  );
  const [onlyAvail, setOnlyAvail] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
    };
  }, []);

  // A later /fleet?type=... navigation must move the chips even if the route
  // component is still mounted from a previous visit — otherwise the link
  // changes the URL and nothing on screen.
  useEffect(() => {
    if (!type) return;
    setCategories(
      Object.fromEntries(MARKETING_CATEGORIES.map((c) => [c, c === type])),
    );
  }, [type]);

  const makes = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.make).filter((m): m is string => !!m))).sort(),
    [vehicles]
  );

  const filtered = vehicles.filter((v) => {
    const cat = v.body_type ?? "sedan";
    return (
      (make === "all" || v.make === make) &&
      categories[cat] &&
      (!onlyAvail || v.status === "available")
    );
  });

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
    return cats.flatMap((c) => marketingFleetByCategory(c)).map((v) => catalogCardModel(v, "apply"));
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} className="accent-[#D03020]" />
              Available Only
            </label>
          </div>
        </FadeUp>
      </section>

      <section className="container-real py-8 md:py-10">
        <FadeUp className="mb-6 flex items-end justify-between gap-4">
          <div className="text-sm md:text-base font-medium">
            Showing <span className="font-semibold">{filtered.length}</span> Available {filtered.length === 1 ? "Vehicle" : "Vehicles"}
          </div>
        </FadeUp>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
          {filtered.map((v, i) => (
            <FadeUp key={v.id} delay={i * 40}>
              <InventoryVehicleCard vehicle={v} />
            </FadeUp>
          ))}
        </div>
        {!loaded && filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">Loading the fleet…</div>
        )}
        {loaded && filtered.length === 0 && (
          <div className="mt-2">
            <FadeUp className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl md:text-3xl">Vehicles Built For Gig Work.</h2>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                These are the types of vehicles we regularly offer. Availability changes
                daily — start your application and we will confirm your car on a quick call.
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