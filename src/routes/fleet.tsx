import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  const [body, setBody] = useState("all");
  const [priceMax, setPriceMax] = useState(500);
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
  const bodies = useMemo(
    () =>
      Array.from(new Set(vehicles.map((v) => v.body_type).filter(Boolean) as string[])).sort(),
    [vehicles]
  );

  const filtered = vehicles.filter(
    (v) =>
      (make === "all" || v.make === make) &&
      (body === "all" || v.body_type === body) &&
      Number(v.weekly_rate) <= priceMax &&
      (!onlyAvail || v.status === "available")
  );

  return (
    <SiteLayout>
      <section className="container-real pt-16 md:pt-24 pb-12">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">The Fleet</div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Every Car. Rideshare-Ready.</h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            Inspected, insured, GPS-equipped. Pick the one you want — apply, drive,
            earn.
          </p>
        </FadeUp>
      </section>

      <section className="container-real">
        <FadeUp>
          <div className="rounded-2xl bg-soft p-5 flex flex-wrap items-center gap-5">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Make</label>
              <select value={make} onChange={(e) => setMake(e.target.value)} className="bg-white border border-border rounded-full px-4 py-2 text-sm">
                <option value="all">All</option>
                {makes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Body</label>
              <select value={body} onChange={(e) => setBody(e.target.value)} className="bg-white border border-border rounded-full px-4 py-2 text-sm capitalize">
                <option value="all">All</option>
                {bodies.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="flex flex-col flex-1 min-w-[200px]">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Max ${priceMax}/wk</label>
              <input type="range" min={300} max={500} step={5} value={priceMax} onChange={(e) => setPriceMax(Number(e.target.value))} className="accent-[#CC0000]" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} className="accent-[#CC0000]" />
              Available only
            </label>
          </div>
        </FadeUp>
      </section>

      <section className="container-real py-12 md:py-16">
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