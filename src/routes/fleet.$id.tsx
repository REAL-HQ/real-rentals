import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { Check, Gauge, Fuel, Calendar, Wrench } from "lucide-react";
import { resolvePhotoUrl } from "@/lib/photoUrl";

export const Route = createFileRoute("/fleet/$id")({
  head: () => ({
    meta: [
      { title: "Vehicle Details — REAL RENTALS" },
      { name: "description", content: "View specs, pricing, and what's included with this rideshare-ready vehicle." },
    ],
  }),
  component: VehicleDetail,
});

function VehicleDetail() {
  const { id } = useParams({ from: "/fleet/$id" });
  const [v, setV] = useState<Tables<"vehicles"> | null>(null);
  const [term, setTerm] = useState<"weekly" | "monthly">("weekly");

  useEffect(() => {
    supabase.from("vehicles").select("*").eq("id", id).maybeSingle().then(({ data }) => setV(data));
  }, [id]);

  if (!v) {
    return (
      <SiteLayout>
        <div className="container-real py-32 text-center text-muted-foreground">Loading…</div>
      </SiteLayout>
    );
  }

  const price = term === "weekly" ? v.weekly_rate : v.monthly_rate ?? Number(v.weekly_rate) * 4;

  return (
    <SiteLayout>
      <section className="container-real pt-12 md:pt-20">
        <FadeUp>
          <Link to="/fleet" className="text-sm text-muted-foreground hover:text-foreground">← Back to fleet</Link>
        </FadeUp>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mt-8">
          <FadeUp>
            <div className="rounded-2xl bg-soft overflow-hidden aspect-[4/3]">
              {v.photos?.[0] && (
                <img src={resolvePhotoUrl(v.photos[0]) ?? ""} alt={`${v.make} ${v.model}`} className="w-full h-full object-cover" />
              )}
            </div>
          </FadeUp>
          <FadeUp delay={80}>
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">{v.year}</div>
            <h1 className="mt-3 text-4xl md:text-5xl font-semibold">{v.make} {v.model}</h1>
            <p className="mt-4 text-muted-foreground leading-relaxed">{v.description}</p>

            <div className="mt-8 inline-flex rounded-lg bg-soft p-1 text-sm">
              {(["weekly", "monthly"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTerm(t)}
                  className={`px-5 py-2 rounded-lg capitalize transition ${term === t ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="mt-5 flex items-baseline gap-2">
              <span className="text-5xl font-semibold">${Number(price)}</span>
              <span className="text-muted-foreground text-sm">/{term === "weekly" ? "week" : "month"}</span>
            </div>
            <div className="text-sm text-muted-foreground mt-1">No deposit required. A payment card on file authorizes tolls, citations, damage, cleaning, and unpaid rent per your rental agreement.</div>

            <div className="mt-8 grid grid-cols-2 gap-4 text-sm">
              {[
                { I: Calendar, l: "Year", v: v.year },
                { I: Gauge, l: "MPG", v: v.mpg ?? "—" },
                { I: Fuel, l: "Body", v: v.body_type ?? "—" },
                { I: Wrench, l: "Status", v: v.status },
              ].map((s) => (
                <div key={s.l} className="flex items-center gap-3 rounded-xl bg-soft p-4">
                  <s.I className="w-5 h-5 text-real-red" strokeWidth={1.75} />
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
                    <div className="font-medium capitalize">{String(s.v)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <div className="text-sm font-medium mb-3">What's included</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {["Insurance options available", "Routine maintenance included", "24/7 driver support"].map((i) => (
                  <li key={i} className="flex gap-2 items-start"><Check className="w-4 h-4 text-real-red mt-0.5" /> {i}</li>
                ))}
              </ul>
            </div>

            <div className="mt-8 sticky bottom-4">
              <Link
                to="/apply"
                search={{ vehicle: v.id }}
                className="inline-flex w-full sm:w-auto justify-center items-center rounded-lg bg-real-red px-8 py-4 text-sm font-medium text-white hover:opacity-90 transition active:scale-95"
              >
                Apply For This Car
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
      <div className="h-20" />
    </SiteLayout>
  );
}