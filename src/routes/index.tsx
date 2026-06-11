import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, Wrench, Infinity as InfinityIcon, Briefcase, ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { VehicleCard } from "@/components/site/VehicleCard";
import { FadeUp } from "@/components/site/FadeUp";
import heroBg from "@/assets/hero-bg.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "REAL AUTOMOTIVE | Start Driving. Start Earning. This Week." },
      { name: "description", content: "Rent a vehicle for Uber, Lyft, DoorDash and delivery work from $350/week. Insurance included. Maintenance included. Fast approval." },
      { property: "og:title", content: "Start Driving. Start Earning. This Week." },
      { property: "og:description", content: "Insurance and maintenance included. Fast approval. Drive this week." },
    ],
  }),
  component: Index,
});

function Index() {
  const [vehicles, setVehicles] = useState<Tables<"vehicles">[]>([]);
  useEffect(() => {
    (async () => {
      const fetchType = (type: string) =>
        supabase
          .from("vehicles")
          .select("*")
          .eq("status", "available")
          .eq("body_type", type)
          .order("weekly_rate", { ascending: true })
          .limit(2)
          .then(({ data }) => data || []);
      const [sedans, suvs, xl] = await Promise.all([
        fetchType("sedan"),
        fetchType("suv"),
        fetchType("xl"),
      ]);
      setVehicles([...sedans, ...suvs, ...xl]);
    })();
  }, []);

  return (
    <SiteLayout>
      <section className="relative w-full px-6 md:px-12 pt-20 md:pt-28 pb-16 md:pb-24 text-center overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/80 via-black/70 to-black/90" />
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">
            Rent. Drive. Earn.
          </div>
          <h1 className="mt-5 text-[40px] md:text-[64px] leading-[1.05] font-semibold mx-auto whitespace-nowrap text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
            Start Driving. Start Earning. This Week.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-white/80 max-w-2xl mx-auto leading-relaxed">
            Rent a vehicle for Uber, Lyft, DoorDash and delivery work from $350/week.
            Insurance included. Maintenance included. Fast approval. Drive this week.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/fleet" className="inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3 text-sm font-medium text-black hover:bg-real-red hover:text-white transition active:scale-95">
              View Available Cars <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/apply" className="inline-flex items-center rounded-lg border border-white/40 px-7 py-3 text-sm font-medium text-white hover:bg-white hover:text-black transition active:scale-95">
              Apply Now
            </Link>
          </div>
        </FadeUp>
        <FadeUp delay={80}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs md:text-sm text-white/75">
            {[
              "Insurance Included",
              "Maintenance Included",
              "Unlimited Miles",
              "Fast Approval",
              "Starting At $350/Week",
            ].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />
                {t}
              </span>
            ))}
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
            <Link to="/fleet" className="text-sm underline-offset-4 hover:underline">View All →</Link>
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
          <h2 className="mt-3 text-3xl md:text-5xl">From Application To Paycheck.</h2>
        </FadeUp>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {[
            { n: "01", t: "Apply", d: "Five minute application." },
            { n: "02", t: "Approve", d: "Usually within 24 hours." },
            { n: "03", t: "Pickup", d: "Drive away the same day." },
            { n: "04", t: "Earn", d: "Start driving immediately." },
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
              { I: Shield, t: "Drive With Confidence", d: "Commercial rideshare insurance is included on every vehicle." },
              { I: Wrench, t: "Maintenance Handled", d: "Routine maintenance is on us. You drive, we keep it running." },
              { I: InfinityIcon, t: "Unlimited Miles", d: "Drive as much as you want. No mileage caps, no overage fees." },
              { I: Briefcase, t: "Built For Gig Work", d: "Uber, Lyft, DoorDash, Instacart, Amazon Flex. Pick your platforms." },
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
            { q: "I applied Tuesday and was earning on Uber by Friday. Made my weekly rent back in three days.", n: "Marcus T.", r: "Uber & Lyft Driver" },
            { q: "My car broke down right before the holidays. REAL had me in a vehicle and back to work in 48 hours.", n: "Priya S.", r: "DoorDash Driver" },
            { q: "No deposit headaches, no surprise fees. I keep what I earn and the maintenance is handled.", n: "Jamal R.", r: "Uber Premier Driver" },
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

    </SiteLayout>
  );
}