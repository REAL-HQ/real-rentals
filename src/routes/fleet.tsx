import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shield, Wrench, BadgeCheck, Navigation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { VehicleCard } from "@/components/site/VehicleCard";
import { FadeUp } from "@/components/site/FadeUp";

export const Route = createFileRoute("/fleet")({
  head: () => ({
    meta: [
      { title: "The Fleet — REAL AUTOMOTIVE" },
      { name: "description", content: "Browse rideshare-ready vehicles. Filter by make, body type, and price. From $350/week." },
      { property: "og:title", content: "The Fleet — REAL AUTOMOTIVE" },
      { property: "og:description", content: "Every car ready for Uber, Lyft, DoorDash, Instacart, and Amazon Flex." },
    ],
  }),
  component: FleetPage,
});

function FleetPage() {
  const [vehicles, setVehicles] = useState<Tables<"vehicles">[]>([]);
  const [make, setMake] = useState("all");
  const [categories, setCategories] = useState<Record<string, boolean>>({
    economy: true,
    comfort: true,
    xl: true,
  });
  const [onlyAvail, setOnlyAvail] = useState(true);

  useEffect(() => {
    supabase
      .from("vehicles")
      .select("*")
      .order("weekly_rate", { ascending: true })
      .then(({ data }) => setVehicles(data || []));
  }, []);

  const makes = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.make))).sort(),
    [vehicles]
  );

  const bodyToCategory: Record<string, string> = {
    sedan: "economy",
    suv: "comfort",
    xl: "xl",
  };

  const filtered = vehicles.filter((v) => {
    const cat = bodyToCategory[v.body_type ?? ""] ?? "economy";
    return (
      (make === "all" || v.make === make) &&
      categories[cat] &&
      (!onlyAvail || v.status === "available")
    );
  });

  const toggleCat = (k: string) =>
    setCategories((c) => ({ ...c, [k]: !c[k] }));

  return (
    <SiteLayout>
      <section className="container-real pt-8 md:pt-10 pb-4">
        <FadeUp>
          <h1 className="text-2xl md:text-3xl font-semibold">Available Vehicles</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs md:text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />Insured</span>
            <span className="inline-flex items-center gap-1.5"><Navigation className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />GPS Equipped</span>
            <span className="inline-flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />Uber/Lyft Eligible</span>
            <span className="inline-flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />Maintenance Included</span>
          </div>
        </FadeUp>
      </section>

      <section className="container-real">
        <FadeUp>
          <div className="rounded-2xl bg-soft p-5 flex flex-wrap items-center gap-5">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Make</label>
              <select value={make} onChange={(e) => setMake(e.target.value)} className="bg-white border border-border rounded-lg pl-4 pr-8 py-2 text-sm">
                <option value="all">All</option>
                {makes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col flex-1 min-w-[260px]">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Category</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { k: "economy", label: "Economy" },
                  { k: "comfort", label: "Comfort" },
                  { k: "xl", label: "XL" },
                ].map((c) => (
                  <button
                    key={c.k}
                    type="button"
                    onClick={() => toggleCat(c.k)}
                    className={`px-4 py-2 rounded-lg text-sm border transition ${
                      categories[c.k]
                        ? "bg-real-red text-white border-real-red"
                        : "bg-white text-foreground border-border hover:border-foreground/40"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} className="accent-[#CC0000]" />
              Available only
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
              <VehicleCard vehicle={v} />
            </FadeUp>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">No vehicles match these filters.</div>
        )}
      </section>
    </SiteLayout>
  );
}