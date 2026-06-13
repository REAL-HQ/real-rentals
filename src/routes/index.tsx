import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, Wrench, Infinity as InfinityIcon, Briefcase, ArrowRight, Check, CalendarDays, FileText, Zap, ClipboardCheck, KeyRound, DollarSign, Users, MapPin, BadgeCheck, LifeBuoy, ScanSearch, Headphones, Car } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { SiteLayout } from "@/components/site/SiteLayout";
import { VehicleCard } from "@/components/site/VehicleCard";
import { FadeUp } from "@/components/site/FadeUp";
import heroBg from "@/assets/hero-bg.jpg";
import fleetPartnerBg from "@/assets/fleet-partner.jpg";

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
      <section className="relative isolate w-full px-6 md:px-12 pt-24 md:pt-36 pb-10 md:pb-14 text-center overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/70 via-black/55 to-black/80" />
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">
            Rent. Drive. Earn.
          </div>
          <h1 className="mt-5 text-[40px] md:text-[64px] leading-[1.05] font-semibold mx-auto whitespace-nowrap text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
            Start Driving. Start Earning. This Week.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-white/80 max-w-4xl mx-auto leading-relaxed whitespace-nowrap">
            Rent A Vehicle For Uber, Lyft, DoorDash And Delivery Work From $350/Week.
            <br />
            Insurance Included. Maintenance Included. Fast Approval. Drive This Week.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/fleet" className="inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3 text-sm font-medium text-black hover:bg-black hover:text-white transition active:scale-95">
              View Available Cars <ArrowRight className="w-4 h-4" />
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
              { label: "Insurance Included", Icon: Shield },
              { label: "Maintenance Included", Icon: Wrench },
              { label: "Unlimited Miles", Icon: InfinityIcon },
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
              <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Featured Fleet</div>
              <h2 className="mt-3 text-3xl md:text-5xl">Vehicles Available Now.</h2>
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

      <section className="container-real py-14 md:py-24">
        <FadeUp className="text-center mb-14 max-w-5xl mx-auto">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">How It Works</div>
          <h2 className="mt-3 text-3xl md:text-5xl">From Application To Paycheck.</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed md:whitespace-nowrap">Four simple steps. No credit check. No long wait. Get behind the wheel and start earning this week.</p>
        </FadeUp>
        <div className="relative">
          <div aria-hidden className="hidden md:block absolute top-8 left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-real-red/30 to-transparent" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-8 relative">
            {[
              { n: "01", I: FileText, t: "Apply", d: "Complete a 5-minute application online from your phone." },
              { n: "02", I: ClipboardCheck, t: "Get Approved", d: "Most applications reviewed the same day. No credit check." },
              { n: "03", I: KeyRound, t: "Pick Up Vehicle", d: "Schedule pickup, complete onboarding, and grab your keys." },
              { n: "04", I: Zap, t: "Start Earning", d: "Drive Uber, Lyft, DoorDash or Instacart immediately." },
            ].map((s, i) => (
              <FadeUp key={s.n} delay={i * 80}>
                <div className="group relative rounded-2xl bg-white p-7 h-full border border-border hover:border-real-red/40 hover:shadow-lg transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-real-red/10 text-real-red transition-colors">
                      <s.I className="w-7 h-7" strokeWidth={1.75} />
                    </div>
                    <div className="text-5xl font-bold text-foreground/5 group-hover:text-real-red/20 transition-colors leading-none">{s.n}</div>
                  </div>
                  <div className="mt-6 text-real-red text-[11px] font-semibold tracking-[0.2em]">STEP {s.n}</div>
                  <div className="mt-2 text-xl font-semibold">{s.t}</div>
                  <div className="mt-2 text-muted-foreground text-sm leading-relaxed">{s.d}</div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
        <FadeUp className="mt-12 text-center">
          <Link to="/apply" className="inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-8 py-4 text-sm font-semibold hover:opacity-90 transition active:scale-95">
            Start Your Application <ArrowRight className="w-4 h-4" />
          </Link>
        </FadeUp>
      </section>

      <section className="bg-soft py-10 md:py-16">
        <div className="container-real">
          <FadeUp className="text-center mb-8">
            <h2 className="text-3xl md:text-5xl">Everything You Need. Nothing You Don't.</h2>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { I: Shield, t: "Insurance Coverage Included", d: "Insurance coverage is included with every vehicle so you can focus on driving." },
              { I: Wrench, t: "Maintenance Handled", d: "Routine maintenance is on us. You drive, we keep it running." },
              { I: InfinityIcon, t: "Unlimited Miles", d: "Drive as much as you want. No mileage caps or overage fees." },
              { I: Briefcase, t: "Built For Gig Work", d: "Uber, Lyft, DoorDash, Instacart, Amazon Flex and more." },
              { I: CalendarDays, t: "Flexible Weekly & Monthly Payments", d: "Choose a payment schedule that fits your driving goals." },
              { I: BadgeCheck, t: "Flexible Rental Terms", d: "No annual commitment required. Stay flexible and stay on the road." },
              { I: Headphones, t: "Dedicated Driver Support", d: "Our team is available to help with questions, vehicle issues, and rental support." },
              { I: Car, t: "Fleet-Inspected Vehicles", d: "Every vehicle is inspected and prepared for rideshare and delivery work before entering the fleet." },
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

      <section className="relative isolate text-white overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-cover bg-center"
          style={{ backgroundImage: `url(${fleetPartnerBg})` }}
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/90 to-black/60" />
        <div className="container-real py-16 md:py-24 grid grid-cols-1 lg:grid-cols-5 gap-10 items-center">
          <div className="lg:col-span-3">
            <FadeUp>
              <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Partner Program</div>
              <h2 className="mt-3 text-3xl md:text-5xl leading-tight">Turn Your Vehicle Into<br />Monthly Cash Flow.</h2>
              <p className="mt-5 text-white/80 leading-relaxed max-w-xl">
                <span className="font-semibold text-white">Own a vehicle?</span> Join the REAL Automotive Partner Program and earn passive income by placing vehicles into our rideshare fleet.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <Link to="/investors" className="inline-flex items-center justify-center rounded-lg bg-real-red text-white px-8 py-4 text-sm font-semibold hover:opacity-90 transition active:scale-95">
                  Become A Partner <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
                <Link to="/investors" className="inline-flex items-center justify-center rounded-lg border border-white/30 text-white px-8 py-4 text-sm font-medium hover:bg-white/10 transition active:scale-95">
                  Learn More
                </Link>
              </div>
            </FadeUp>
          </div>
          <div className="lg:col-span-2">
            <FadeUp delay={80}>
              <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                <div className="text-[11px] uppercase tracking-wider text-white/60 font-semibold">We Handle Everything</div>
                <ul className="mt-4 grid grid-cols-1 gap-3 text-sm">
                  {[
                    { I: Users, t: "Driver Acquisition" },
                    { I: ScanSearch, t: "Screening" },
                    { I: DollarSign, t: "Collections" },
                    { I: MapPin, t: "GPS Tracking" },
                    { I: Briefcase, t: "Fleet Management" },
                    { I: LifeBuoy, t: "Vehicle Support" },
                  ].map((x) => (
                    <li key={x.t} className="flex items-center gap-3">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-real-red/15 text-real-red">
                        <x.I className="w-4 h-4" strokeWidth={2} />
                      </span>
                      <span className="text-white/90">{x.t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      <section className="bg-soft py-10 md:py-16">
        <div className="container-real">
          <FadeUp className="text-center mb-8">
            <h2 className="text-3xl md:text-5xl">Questions, Answered.</h2>
          </FadeUp>
          <div className="max-w-3xl mx-auto divide-y divide-border bg-white rounded-2xl">
            {[
              { q: "What is required to get approved?", a: "You must be 21+, hold a valid US driver's license for at least one year, and have a reasonably clean driving record. No credit check required." },
              { q: "Is a refundable security deposit required?", a: "Yes. A $250 refundable deposit is required and is returned 14 to 30 days after rental ends." },
              { q: "What is included in the weekly payment?", a: "Commercial rideshare insurance, routine maintenance, unlimited miles, and 24/7 driver support." },
              { q: "Can I drive for Uber and Lyft?", a: "Yes. Every vehicle is eligible for both Uber and Lyft, on the same car." },
              { q: "Are maintenance and repairs included?", a: "Routine maintenance and most mechanical repairs are on us." },
              { q: "How quickly can I get approved?", a: "Most applications are reviewed the same day, with same-day pickup available." },
              { q: "Is insurance included?", a: "Yes. Commercial rideshare insurance is included on every vehicle." },
              { q: "Can I use the vehicle for DoorDash and Instacart?", a: "Yes. DoorDash, Instacart, Uber Eats, and Amazon Flex are all permitted." },
              { q: "What happens if my vehicle needs repairs?", a: "Contact support and we'll schedule a swap or service appointment to get you back on the road quickly." },
              { q: "How do fleet partners earn money?", a: "Partners earn passive monthly income on a 50/50 split of rent collected. We handle drivers, screening, collections, and maintenance." },
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
            <Link to="/faq" className="text-sm underline-offset-4 hover:underline">See All FAQs →</Link>
          </div>
        </div>
      </section>

    </SiteLayout>
  );
}