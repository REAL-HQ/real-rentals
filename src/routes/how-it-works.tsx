import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { Check, X, FileText, ClipboardCheck, KeyRound, Zap, ArrowRight, Shield, Wrench, LifeBuoy, FileCheck, Headphones, Fuel, Sparkles, Receipt, RotateCcw, CalendarClock, IdCard, CarFront, UserCheck, Wallet, CreditCard, Briefcase } from "lucide-react";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How It Works — REAL RENTALS" },
      { name: "description", content: "Book, get approved, pick up your car, and start earning — usually within 48 hours." },
      { property: "og:title", content: "How It Works — REAL RENTALS" },
      { property: "og:description", content: "From application to first ride in 48 hours." },
    ],
  }),
  component: HowItWorks,
});

function HowItWorks() {
  return (
    <SiteLayout>
      {/* Hero */}
      <section className="relative isolate w-full px-6 md:px-12 pt-24 md:pt-36 pb-14 md:pb-20 text-center overflow-hidden bg-black">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(220,38,38,0.25),transparent_60%)]" />
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">How It Works</div>
          <h1 className="mt-5 text-[40px] md:text-[64px] leading-[1.05] font-semibold text-white">From Apply To Earning.<br />In Days, Not Weeks.</h1>
          <p className="mt-6 text-lg md:text-xl text-white/75 max-w-2xl mx-auto leading-relaxed">
            Four Simple Steps. No Credit Check. No Long Wait. Get Behind The Wheel And Start Earning This Week.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/apply" className="inline-flex items-center gap-2 rounded-lg bg-real-red px-7 py-3 text-sm font-medium text-white hover:opacity-90 transition active:scale-95">
              Start Your Application <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/fleet" className="inline-flex items-center rounded-lg border border-white/40 px-7 py-3 text-sm font-medium text-white hover:bg-white hover:text-black transition active:scale-95">
              Browse Vehicles
            </Link>
          </div>
        </FadeUp>
      </section>

      {/* Steps */}
      <section className="container-real py-14 md:py-24">
        <FadeUp className="text-center mb-14 max-w-3xl mx-auto">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">The Process</div>
          <h2 className="mt-3 text-3xl md:text-5xl">From Application To Paycheck.</h2>
        </FadeUp>
        <div className="relative">
          <div aria-hidden className="hidden md:block absolute top-8 left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-real-red/30 to-transparent" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-8 relative">
            {[
              { n: "01", I: FileText, t: "Apply Online", d: "Five Minutes. Personal Info, License, Gig Platforms, And Vehicle Preference. We Save Your Progress Between Steps." },
              { n: "02", I: ClipboardCheck, t: "Get Approved Fast", d: "We Run An MVR And Background Check. Most Drivers Hear Back The Same Day. No Credit Check Required." },
              { n: "03", I: KeyRound, t: "Pick Up Your Car", d: "Schedule Pickup At Our Lot. Your Vehicle Is Detailed, Inspected, Fueled, And Rideshare-Ready." },
              { n: "04", I: Zap, t: "Start Earning", d: "Activate Your Gig Accounts And Start Driving. Pay Weekly Rent In Advance. No Contracts, No Surprises." },
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
      </section>

      {/* Requirements */}
      <section className="bg-soft py-14 md:py-24">
        <div className="container-real">
          <FadeUp className="text-center mb-12 max-w-3xl mx-auto">
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Requirements</div>
            <h2 className="mt-3 text-3xl md:text-5xl">What You Need To Get Started.</h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">Simple, Driver-Friendly Requirements. No Credit Check, No Surprises.</p>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { I: UserCheck, t: "21 Years Or Older", d: "Minimum Age Requirement For All Drivers In Our Program." },
              { I: IdCard, t: "Valid US Driver's License", d: "Held For At Least One Year With No Major Restrictions." },
              { I: CarFront, t: "Clean Driving Record", d: "Reasonably Clean MVR. We'll Let You Know If You Qualify." },
              { I: Briefcase, t: "Active Gig Account", d: "Or Willingness To Sign Up For Uber, Lyft, DoorDash, Or Instacart." },
              { I: Wallet, t: "No Deposit", d: "$0 Security Deposit. We Keep A Payment Card On File For Tolls, Citations, Damage, And Unpaid Rent Per Your Rental Agreement." },
              { I: CreditCard, t: "Payment Method", d: "Debit Card, Credit Card, Or Cash App For Weekly Rent." },
            ].map((r, i) => (
              <FadeUp key={r.t} delay={i * 60}>
                <div className="rounded-2xl bg-white p-7 h-full border border-border hover:border-real-red/40 hover:shadow-lg transition-all duration-300">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-real-red/10 text-real-red">
                    <r.I className="w-6 h-6" strokeWidth={1.75} />
                  </div>
                  <div className="mt-5 text-lg font-semibold">{r.t}</div>
                  <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{r.d}</div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Included vs Responsibilities */}
      <section className="container-real py-14 md:py-24">
        <FadeUp className="text-center mb-12 max-w-3xl mx-auto">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">What's Covered</div>
          <h2 className="mt-3 text-3xl md:text-5xl">We Handle The Heavy Lifting.</h2>
        </FadeUp>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FadeUp>
            <div className="rounded-2xl bg-white p-8 h-full border border-border">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-real-red/10 text-real-red">
                  <Check className="w-5 h-5" strokeWidth={2.25} />
                </span>
                <h3 className="text-2xl font-semibold">What's Included</h3>
              </div>
              <ul className="mt-6 space-y-4">
                {[
                  { I: Shield, t: "Insurance Options Available" },
                  { I: Wrench, t: "Routine Maintenance & Oil Changes" },
                  { I: LifeBuoy, t: "24/7 Roadside Assistance" },
                  { I: FileCheck, t: "Vehicle Registration & Inspection" },
                  { I: Headphones, t: "24/7 Driver Support" },
                ].map((i) => (
                  <li key={i.t} className="flex items-center gap-3 text-sm">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-soft text-real-red">
                      <i.I className="w-4 h-4" strokeWidth={2} />
                    </span>
                    <span className="font-medium">{i.t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </FadeUp>
          <FadeUp delay={80}>
            <div className="rounded-2xl bg-foreground text-white p-8 h-full">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 text-white">
                  <X className="w-5 h-5" strokeWidth={2.25} />
                </span>
                <h3 className="text-2xl font-semibold">Driver Responsibilities</h3>
              </div>
              <ul className="mt-6 space-y-4">
                {[
                  { I: Fuel, t: "Fuel And EV Charging" },
                  { I: Sparkles, t: "Cleanliness (Interior + Exterior)" },
                  { I: Receipt, t: "Tolls And Tickets" },
                  { I: RotateCcw, t: "Return Vehicle In Same Condition" },
                  { I: CalendarClock, t: "Pay Weekly Rent In Advance" },
                ].map((i) => (
                  <li key={i.t} className="flex items-center gap-3 text-sm">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 text-white">
                      <i.I className="w-4 h-4" strokeWidth={2} />
                    </span>
                    <span className="font-medium">{i.t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* Timeline */}
      <section className="bg-soft py-14 md:py-24">
        <div className="container-real">
          <FadeUp className="text-center mb-12 max-w-3xl mx-auto">
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Your Timeline</div>
            <h2 className="mt-3 text-3xl md:text-5xl">From Click To Cash. Fast.</h2>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { time: "5 Min", t: "Book Your Car", d: "Complete Your Booking From Your Phone." },
              { time: "Same Day", t: "Approved", d: "Most Drivers Hear Back The Same Day They Apply." },
              { time: "48 Hrs", t: "On The Road", d: "Pick Up Your Keys And Start Driving." },
            ].map((s, i) => (
              <FadeUp key={s.t} delay={i * 80}>
                <div className="rounded-2xl bg-white p-7 h-full border border-border text-center">
                  <div className="text-4xl md:text-5xl font-semibold text-real-red">{s.time}</div>
                  <div className="mt-3 text-lg font-semibold">{s.t}</div>
                  <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.d}</div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative isolate text-white overflow-hidden bg-black">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_bottom,rgba(220,38,38,0.3),transparent_60%)]" />
        <div className="container-real py-16 md:py-24 text-center">
          <FadeUp>
            <h2 className="text-3xl md:text-5xl leading-tight">Ready To Start Earning?</h2>
            <p className="mt-5 text-white/80 leading-relaxed max-w-xl mx-auto">
              Apply Today And Be Driving By This Weekend. No Credit Check. No Long-Term Contract.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link to="/apply" className="inline-flex items-center gap-2 rounded-lg bg-real-red px-8 py-4 text-sm font-semibold text-white hover:opacity-90 transition active:scale-95">
                Start Your Application <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/contact" className="inline-flex items-center rounded-lg border border-white/30 px-8 py-4 text-sm font-medium text-white hover:bg-white/10 transition active:scale-95">
                Talk To A Human
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </SiteLayout>
  );
}