import { createFileRoute, Link, useParams, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { Check, Gauge, Fuel, Calendar, Wrench } from "lucide-react";
import { resolvePhotoUrl } from "@/lib/photoUrl";

export const Route = createFileRoute("/fleet/$id")({
  loader: async ({ params }) => {
    const { data } = await supabase
      .from("vehicles")
      .select("id, make, model, weekly_rate, status")
      .eq("id", params.id)
      .maybeSingle();
    if (!data || data.status === "retired") throw notFound();
    return { vehicle: data };
  },
  head: ({ params, loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Vehicle Not Available — REAL RENTALS" },
          { name: "description", content: "This vehicle is no longer listed." },
          { name: "robots", content: "noindex, nofollow" },
        ],
      };
    }
    const v = loaderData?.vehicle;
    const name = v ? `${v.make ?? ""} ${v.model ?? ""}`.trim() : "";
    const title = name
      ? `Rent A ${name} For Uber, Lyft & Delivery | REAL RENTALS`
      : "Vehicle Details — REAL RENTALS";
    const description = name
      ? `Rent a ${name} for rideshare and delivery${v?.weekly_rate ? ` from $${v.weekly_rate}/week` : ""}. Unlimited miles, maintenance included, no deposit.`
      : "View specs, pricing, and what's included with this rideshare-ready vehicle.";
    const url = `https://drivereal.com/fleet/${params.id}`;
    const scripts = [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://drivereal.com/" },
            { "@type": "ListItem", position: 2, name: "Fleet", item: "https://drivereal.com/fleet" },
            { "@type": "ListItem", position: 3, name: name || "Vehicle", item: url },
          ],
        }),
      },
    ];
    if (name) {
      scripts.unshift({
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name,
          description,
          brand: { "@type": "Brand", name: v?.make ?? "REAL RENTALS" },
          url,
          ...(v?.weekly_rate
            ? {
                offers: {
                  "@type": "Offer",
                  price: String(v.weekly_rate),
                  priceCurrency: "USD",
                  availability: "https://schema.org/InStock",
                  url,
                },
              }
            : {}),
        }),
      });
    }
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "product" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts,
    };
  },
  component: VehicleDetail,
});

function VehicleNotFound() {
  return (
    <SiteLayout>
      <section className="container-real py-32 text-center">
        <h1 className="text-3xl font-semibold">Vehicle Not Available</h1>
        <p className="mt-3 text-muted-foreground">This vehicle is no longer listed.</p>
        <Link to="/fleet" className="mt-8 inline-flex rounded-lg bg-real-red px-6 py-3 text-sm font-medium text-white">
          Browse Fleet
        </Link>
      </section>
    </SiteLayout>
  );
}

function VehicleDetail() {
  const { id } = useParams({ from: "/fleet/$id" });
  const [v, setV] = useState<Tables<"vehicles"> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [term, setTerm] = useState<"weekly" | "monthly">("weekly");

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setV(null);
    supabase
      .from("vehicles")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setStatus("missing");
          return;
        }
        setV(data);
        setStatus("ready");
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (status === "loading") {
    return (
      <SiteLayout>
        <div className="container-real py-32 text-center text-muted-foreground">Loading…</div>
      </SiteLayout>
    );
  }

  if (!v) {
    return (
      <SiteLayout>
        <div className="container-real py-32 text-center">
          <h1 className="text-2xl font-semibold">Vehicle Not Available</h1>
          <p className="mt-3 text-muted-foreground">
            This vehicle is no longer listed. Browse the current fleet to find another ride.
          </p>
          <Link
            to="/fleet"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-real-red px-5 py-2.5 text-sm font-medium text-white"
          >
            View Fleet
          </Link>
        </div>
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
                {["No deposit — payment card on file", "Routine maintenance included", "24/7 driver support"].map((i) => (
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
                Book This Car
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
      <div className="h-20" />
    </SiteLayout>
  );
}