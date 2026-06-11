import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { Check, X } from "lucide-react";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How It Works — REAL AUTOMOTIVE" },
      { name: "description", content: "Apply, get approved, pick up your car, and start earning — usually within 48 hours." },
      { property: "og:title", content: "How It Works — REAL AUTOMOTIVE" },
      { property: "og:description", content: "From application to first ride in 48 hours." },
    ],
  }),
  component: HowItWorks,
});

function HowItWorks() {
  return (
    <SiteLayout>
      <section className="container-real pt-16 md:pt-24 pb-16 text-center">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">How It Works</div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold">From Apply To Earning. In Days.</h1>
        </FadeUp>
      </section>

      <section className="container-real space-y-20">
        {[
          { n: "01", t: "Apply Online", d: "Five minutes. Personal info, license, gig platforms, vehicle preference. We save your progress between steps." },
          { n: "02", t: "Get Approved Fast", d: "We run an MVR + background check and review your application. Most drivers hear back within 24 hours." },
          { n: "03", t: "Pick Up Your Car", d: "Schedule pickup at our lot. Your vehicle is detailed, inspected, fueled, GPS-installed, and rideshare-ready." },
          { n: "04", t: "Start Earning", d: "Activate your gig accounts and start driving. Pay weekly rent in advance. No contracts, no surprises." },
        ].map((s, i) => (
          <FadeUp key={s.n} delay={i * 60}>
            <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-6 md:gap-12">
              <div className="text-5xl font-semibold text-real-red">{s.n}</div>
              <div>
                <div className="text-2xl md:text-3xl font-semibold">{s.t}</div>
                <p className="mt-3 text-muted-foreground leading-relaxed max-w-2xl">{s.d}</p>
              </div>
            </div>
          </FadeUp>
        ))}
      </section>

      <section className="container-real py-24">
        <FadeUp>
          <h2 className="text-3xl md:text-4xl font-semibold mb-10">Requirements</h2>
        </FadeUp>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          {[
            "21 years or older",
            "Valid US driver's license (1+ years)",
            "Clean enough driving record (we'll let you know)",
            "Active rideshare/delivery account (or willingness to sign up)",
            "Refundable deposit ($249–$500)",
            "Debit card, credit card, or Cash App for weekly rent",
          ].map((r) => (
            <div key={r} className="flex items-start gap-3 text-sm">
              <Check className="w-5 h-5 text-real-red mt-0.5" /> {r}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-soft py-24">
        <div className="container-real grid grid-cols-1 md:grid-cols-2 gap-12">
          <FadeUp>
            <h3 className="text-2xl font-semibold mb-6">What's Included</h3>
            <ul className="space-y-3 text-sm">
              {["Commercial rideshare insurance", "GPS tracking device", "Routine maintenance & oil changes", "Roadside assistance", "Vehicle registration & inspection", "24/7 support"].map((i) => (
                <li key={i} className="flex gap-3"><Check className="w-5 h-5 text-real-red" /> {i}</li>
              ))}
            </ul>
          </FadeUp>
          <FadeUp delay={80}>
            <h3 className="text-2xl font-semibold mb-6">Driver Responsibilities</h3>
            <ul className="space-y-3 text-sm">
              {["Fuel and EV charging", "Cleanliness (interior + exterior)", "Tolls and tickets", "Return vehicle in same condition", "Pay weekly rent in advance"].map((i) => (
                <li key={i} className="flex gap-3"><X className="w-5 h-5 text-muted-foreground" /> {i}</li>
              ))}
            </ul>
          </FadeUp>
        </div>
      </section>

      <section className="container-real py-24 text-center">
        <FadeUp>
          <Link to="/apply" className="inline-flex items-center rounded-lg bg-real-red px-8 py-4 text-sm font-medium text-white hover:opacity-90 transition active:scale-95">
            Start Your Application
          </Link>
        </FadeUp>
      </section>
    </SiteLayout>
  );
}