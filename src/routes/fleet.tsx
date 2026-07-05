import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shield, Wrench, BadgeCheck, Check, Infinity as InfinityIcon, Zap, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { VehicleCard } from "@/components/site/VehicleCard";
import { FadeUp } from "@/components/site/FadeUp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/fleet")({
  head: () => ({
    meta: [
      { title: "The Fleet — REAL RENTALS" },
      { name: "description", content: "Browse rideshare-ready vehicles. Filter by make, body type, and price. From $350/week." },
      { property: "og:title", content: "The Fleet — REAL RENTALS" },
      { property: "og:description", content: "Every car ready for Uber, Lyft, DoorDash, Instacart, and Amazon Flex." },
    ],
  }),
  component: FleetPage,
});

function FleetPage() {
  const [vehicles, setVehicles] = useState<Tables<"vehicles">[]>([]);
  const [make, setMake] = useState("all");
  const [categories, setCategories] = useState<Record<string, boolean>>({
    sedan: true,
    suv: true,
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
                  { k: "sedan", label: "Sedans", tagline: "Great MPG · Uber & Lyft" },
                  { k: "suv", label: "SUVs", tagline: "More Room · Comfort Rides" },
                  { k: "xl", label: "XL Vehicles", tagline: "6+ Seats · UberXL & Lyft XL" },
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
              <input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} className="accent-[#CC0000]" />
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