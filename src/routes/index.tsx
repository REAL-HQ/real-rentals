import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, Wrench, Zap, MapPin, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { VehicleCard } from "@/components/site/VehicleCard";
import { FadeUp } from "@/components/site/FadeUp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "REAL AUTOMOTIVE — Rent. Drive. Earn." },
      { name: "description", content: "Rideshare-ready vehicles from $350/week. GPS included, maintenance handled, approval in 24 hours." },
      { property: "og:title", content: "REAL AUTOMOTIVE — Rent. Drive. Earn." },
      { property: "og:description", content: "Your car for Uber, Lyft and delivery. Ready today." },
    ],
  }),
  component: Index,
});

function Index() {
  const [vehicles, setVehicles] = useState<Tables<"vehicles">[]>([]);
  useEffect(() => {
    supabase
      .from("vehicles")
      .select("*")
      .eq("status", "available")
      .order("weekly_rate", { ascending: true })
      .limit(6)
      .then(({ data }) => setVehicles(data || []));
  }, []);

  return (
    <SiteLayout>
      <section className="container-real pt-20 md:pt-28 pb-16 md:pb-24 text-center">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">
            Rent. Drive. Earn.
          </div>
          <h1 className="mt-5 text-[40px] md:text-[64px] leading-[1.05] font-semibold max-w-4xl mx-auto">
            Your Car For Uber, Lyft And Delivery. Ready Today.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Rideshare-ready vehicles from $350 per week. GPS included, maintenance
            handled, approval in as little as 24 hours. Apply in minutes — drive this
            week.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/fleet" className="inline-flex items-center gap-2 rounded-lg bg-black px-7 py-3 text-sm font-medium text-white hover:bg-real-red transition active:scale-95">
              Browse The Fleet <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/apply" className="inline-flex items-center rounded-lg border border-border px-7 py-3 text-sm font-medium hover:border-black transition active:scale-95">
              Apply To Drive
            </Link>
          </div>
        </FadeUp>
      </section>

      <section className="bg-soft py-20 md:py-28">
        <div className="container-real">
          <FadeUp className="mb-12 flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Featured Fleet</div>
              <h2 className="mt-3 text-3xl md:text-5xl">Available This Week.</h2>
            </div>
            <Link to="/fleet" className="text-sm underline-offset-4 hover:underline">View all vehicles →</Link>
          </FadeUp>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
            {vehicles.map((v, i) => (
              <FadeUp key={v.id} delay={i * 60}>
                <VehicleCard vehicle={v} />
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <section className="container-real py-20 md:py-28">
        <FadeUp className="text-center mb-14">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">How It Works</div>
          <h2 className="mt-3 text-3xl md:text-5xl">Four Steps To The Driver's Seat.</h2>
        </FadeUp>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {[
            { n: "01", t: "Apply Online", d: "Five minutes, no paperwork, no dealership games." },
            { n: "02", t: "Get Approved Fast", d: "We verify your license and driving record, usually within 24 hours." },
            { n: "03", t: "Pick Up Your Car", d: "Inspected, fueled, and rideshare-ready the day you arrive." },
            { n: "04", t: "Start Earning", d: "Drive for any platform. Weekly rent, no long-term debt, no surprises." },
          ].map((s, i) => (
            <FadeUp key={s.n} delay={i * 80}>
              <div className="text-real-red text-sm font-semibold tracking-wider">{s.n}</div>
              <div className="mt-2 text-lg font-semibold">{s.t}</div>
              <div className="mt-2 text-muted-foreground text-sm leading-relaxed">{s.d}</div>
            </FadeUp>
          ))}
        </div>
      </section>

      <section className="bg-soft py-20 md:py-28">
        <div className="container-real">
          <FadeUp className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl">Everything You Need. Nothing You Don't.</h2>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { I: Shield, t: "Drive With Confidence", d: "Every vehicle is inspected, tracked, and maintained by our team." },
              { I: Wrench, t: "Maintenance Handled", d: "Routine maintenance is on us. You drive, we keep it running." },
              { I: Zap, t: "Approved Fast", d: "Most drivers are approved within 24 hours and on the road the same week." },
              { I: MapPin, t: "Built For Gig Work", d: "Unlimited platform use — Uber, Lyft, DoorDash, Instacart, Amazon Flex." },
            ].map((b, i) => (
              <FadeUp key={b.t} delay={i * 60}>
                <div className="rounded-2xl bg-white p-7 h-full border border-border">
                  <b.I className="w-6 h-6 text-real-red" strokeWidth={1.75} />
                  <div className="mt-5 text-lg font-semibold">{b.t}</div>
                  <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{b.d}</div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <section className="container-real py-20 md:py-28">
        <FadeUp className="text-center mb-14">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Drivers</div>
          <h2 className="mt-3 text-3xl md:text-5xl">From The Driver's Seat.</h2>
        </FadeUp>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
          {[
            { q: "Picked up Monday, made rent back by Friday. No nonsense.", n: "Marcus T.", r: "Uber & Lyft" },
            { q: "I was driving for DoorDash within 48 hours of applying. Insanely smooth.", n: "Priya S.", r: "DoorDash" },
            { q: "The Prius alone pays for itself in gas savings.", n: "Jamal R.", r: "Uber Premier" },
          ].map((t, i) => (
            <FadeUp key={t.n} delay={i * 60}>
              <div className="rounded-2xl bg-soft p-7 h-full">
                <p className="text-lg leading-relaxed">"{t.q}"</p>
                <div className="mt-6 text-sm">
                  <div className="font-medium">{t.n}</div>
                  <div className="text-muted-foreground">{t.r}</div>
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      <section className="bg-soft py-20 md:py-28">
        <div className="container-real">
          <FadeUp className="text-center mb-12">
            <h2 className="text-3xl md:text-5xl">Questions, Answered.</h2>
          </FadeUp>
          <div className="max-w-3xl mx-auto divide-y divide-border bg-white rounded-2xl">
            {[
              { q: "Is insurance included?", a: "Commercial rideshare insurance is included on every vehicle." },
              { q: "What's the mileage limit?", a: "Unlimited miles for rideshare and delivery driving." },
              { q: "How fast is approval?", a: "Most applications are reviewed within 24 hours." },
            ].map((f) => (
              <details key={f.q} className="group p-6">
                <summary className="cursor-pointer flex items-center justify-between text-base font-medium list-none">
                  {f.q}
                  <span className="text-muted-foreground group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link to="/faq" className="text-sm underline-offset-4 hover:underline">See all FAQs →</Link>
          </div>
        </div>
      </section>

      <section className="bg-real-red text-white">
        <div className="container-real py-20 md:py-28 text-center">
          <FadeUp>
            <h2 className="text-3xl md:text-5xl font-semibold">Your Next Paycheck Is Parked Here.</h2>
            <div className="mt-8">
              <Link to="/apply" className="inline-flex items-center rounded-lg bg-white text-foreground px-8 py-3.5 text-sm font-medium hover:bg-soft transition active:scale-95">
                Apply To Drive Today
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </SiteLayout>
  );
}