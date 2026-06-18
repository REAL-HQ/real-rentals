import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Shield, Wrench, Infinity as InfinityIcon, Zap, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { VehicleCard } from "@/components/site/VehicleCard";
import { FadeUp } from "@/components/site/FadeUp";
import heroBg from "@/assets/hero-bg.jpg";

type Site = {
  id: string;
  slug: string;
  title: string;
  market_id: string | null;
  is_published: boolean;
};

type Market = { id: string; name: string; state: string | null; slug: string };

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) => {
    const { data: site } = await supabase
      .from("sites")
      .select("*")
      .eq("slug", params.slug)
      .eq("is_published", true)
      .maybeSingle();
    if (!site) throw notFound();
    let market: Market | null = null;
    if (site.market_id) {
      const { data } = await supabase
        .from("markets")
        .select("id, name, state, slug")
        .eq("id", site.market_id)
        .maybeSingle();
      market = (data as Market) ?? null;
    }
    return { site: site as Site, market };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.site.title ?? "City";
    const state = loaderData?.market?.state ? `, ${loaderData.market.state}` : "";
    return {
      meta: [
        { title: `Rideshare & Delivery Car Rentals in ${title}${state} | REAL AUTOMOTIVE` },
        { name: "description", content: `Rent a vehicle in ${title}${state} for Uber, Lyft, DoorDash and delivery work from $350/week. Insurance options available. Maintenance included. Fast approval.` },
        { property: "og:title", content: `Drive & Earn in ${title}${state}` },
        { property: "og:description", content: `Weekly car rentals in ${title} for rideshare and delivery drivers.` },
      ],
    };
  },
  notFoundComponent: () => (
    <SiteLayout>
      <section className="container-real py-32 text-center">
        <h1 className="text-4xl md:text-5xl font-semibold">City Not Found</h1>
        <p className="mt-4 text-muted-foreground">We're not in this market yet.</p>
        <Link to="/" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-6 py-3 text-sm font-medium">
          Back Home <ArrowRight className="w-4 h-4" />
        </Link>
      </section>
    </SiteLayout>
  ),
  errorComponent: ({ error, reset }) => {
    const navigate = useNavigate();
    return (
      <SiteLayout>
        <section className="container-real py-32 text-center">
          <h1 className="text-3xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-muted-foreground">{error.message}</p>
          <button onClick={() => { reset(); navigate({ to: "/" }); }} className="mt-6 rounded-lg bg-real-red text-white px-6 py-3 text-sm font-medium">Back Home</button>
        </section>
      </SiteLayout>
    );
  },
  component: CityPage,
});

function CityPage() {
  const { site, market } = Route.useLoaderData();
  const [vehicles, setVehicles] = useState<Tables<"vehicles">[]>([]);

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("vehicles")
        .select("*")
        .eq("status", "available")
        .order("weekly_rate", { ascending: true })
        .limit(6);
      if (site.market_id) q = q.eq("market_id", site.market_id);
      const { data } = await q;
      setVehicles(data ?? []);
    })();
  }, [site.market_id]);

  const cityLabel = market?.state ? `${site.title}, ${market.state}` : site.title;

  return (
    <SiteLayout>
      <section className="relative isolate w-full px-6 md:px-12 pt-24 md:pt-36 pb-10 md:pb-14 text-center overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: `url(${heroBg})` }} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/70 via-black/55 to-black/80" />
        <FadeUp>
          <div className="inline-flex items-center gap-2 text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">
            <MapPin className="w-3.5 h-3.5" /> {cityLabel}
          </div>
          <h1 className="mt-5 text-[40px] md:text-[64px] leading-[1.05] font-semibold mx-auto text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
            Drive Uber & Lyft in {site.title}. <br className="hidden md:block" />Start This Week.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-white/80 max-w-3xl mx-auto leading-relaxed">
            Weekly rentals for rideshare and delivery drivers in {cityLabel}. From $350/week. Insurance options available. Maintenance included.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/fleet" className="inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3 text-sm font-medium text-black hover:bg-black hover:text-white transition active:scale-95">
              View {site.title} Fleet <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/apply" className="inline-flex items-center rounded-lg border border-white/40 px-7 py-3 text-sm font-medium text-white hover:bg-white hover:text-black transition active:scale-95">
              Apply Now
            </Link>
          </div>
        </FadeUp>
      </section>

      <section className="border-y border-border bg-white">
        <div className="container-real py-5 md:py-6">
          <div className="flex flex-wrap items-center justify-center gap-x-8 md:gap-x-10 gap-y-3 text-sm md:text-base font-medium text-foreground">
            {[
              { label: "No Credit Check", Icon: Check },
              { label: "Insurance Options Available", Icon: Shield },
              { label: "Maintenance Included", Icon: Wrench },
              { label: "High-Mileage Friendly", Icon: InfinityIcon },
              { label: "Same-Day Approval", Icon: Zap },
            ].map(({ label, Icon }) => (
              <span key={label} className="inline-flex items-center gap-2">
                <Icon className="w-4 h-4 md:w-[18px] md:h-[18px] text-real-red shrink-0" strokeWidth={2.25} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-soft py-10 md:py-16">
        <div className="container-real">
          <FadeUp className="mb-6 flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Available in {site.title}</div>
              <h2 className="mt-3 text-3xl md:text-5xl">Vehicles Ready To Drive.</h2>
            </div>
            <Link to="/fleet" className="text-sm underline-offset-4 hover:underline">View All →</Link>
          </FadeUp>
          {vehicles.length === 0 ? (
            <div className="rounded-xl border border-border bg-white p-10 text-center text-muted-foreground">
              No vehicles listed for {site.title} yet. <Link to="/fleet" className="underline">Browse the full fleet →</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
              {vehicles.map((v, i) => (
                <FadeUp key={v.id} delay={i * 60}>
                  <VehicleCard vehicle={v} />
                </FadeUp>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="relative isolate text-white overflow-hidden bg-black">
        <div className="container-real py-16 md:py-20 text-center">
          <FadeUp>
            <h2 className="text-3xl md:text-5xl">Ready To Earn In {site.title}?</h2>
            <p className="mt-4 text-white/70 max-w-2xl mx-auto">Apply in under 5 minutes. Most {site.title} drivers are approved the same day.</p>
            <Link to="/apply" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-8 py-4 text-sm font-semibold hover:opacity-90 transition active:scale-95">
              Start Your Application <ArrowRight className="w-4 h-4" />
            </Link>
          </FadeUp>
        </div>
      </section>
    </SiteLayout>
  );
}