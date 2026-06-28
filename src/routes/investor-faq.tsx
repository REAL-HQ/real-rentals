import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";

export const Route = createFileRoute("/investor-faq")({
  head: () => ({
    meta: [
      { title: "Investor FAQ — REAL RENTALS" },
      { name: "description", content: "Answers for fleet partners and investors: profit splits, screening, maintenance, recovery, and payouts." },
      { property: "og:title", content: "Investor FAQ — REAL RENTALS" },
      { property: "og:description", content: "Everything you need to know before placing a vehicle into the fleet." },
    ],
  }),
  component: InvestorFAQ,
});

const faqs = [
  { q: "How does the 50/50 split work?", a: "After insurance and any pass-through costs, weekly rent collected on your vehicle is split 50/50 between you and REAL RENTALS. Payouts are sent monthly with a full statement." },
  { q: "Who is responsible for maintenance?", a: "We handle scheduling and oversight of routine maintenance and most repairs. Maintenance costs are deducted before the split or billed transparently depending on the agreement." },
  { q: "How do you screen drivers?", a: "Every driver passes a background check, motor vehicle record review, identity verification, and platform eligibility check before being placed in a vehicle." },
  { q: "What happens if a driver stops paying?", a: "We handle collections and, if needed, recovery of the vehicle. GPS tracking is installed on every fleet car so we can locate and recover quickly." },
  { q: "Do I need to live in Tampa to invest?", a: "No. Most of our fleet partners are out-of-state. We handle all local operations, driver handoffs, inspections, and maintenance." },
  { q: "What types of vehicles do you accept?", a: "Rideshare-eligible sedans, SUVs, and minivans — typically 2018 or newer with under 80,000 miles. We can advise on what's currently in demand." },
  { q: "How long until my vehicle is earning?", a: "Most vehicles are inspected, onboarded, and placed with a driver within one to two weeks of arriving in the fleet." },
  { q: "What insurance is in place on my vehicle?", a: "Commercial rideshare insurance covers the vehicle while in service. We can share the policy details and certificate of insurance on request." },
  { q: "Can I sell or pull my vehicle out of the fleet?", a: "Yes. With reasonable notice we'll transition the driver, retrieve the vehicle, and return it to you in the agreed condition." },
  { q: "How do I get started?", a: "Request the investor deck from the Investors page. A partner will follow up within one business day to walk through terms and next steps." },
];

function InvestorFAQ() {
  return (
    <SiteLayout>
      <section className="container-real pt-16 md:pt-24 pb-12 text-center">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Investor FAQ</div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Partner Questions, Answered.</h1>
        </FadeUp>
      </section>
      <section className="container-real pb-24">
        <FadeUp>
          <div className="max-w-3xl mx-auto divide-y divide-border rounded-2xl border border-border">
            {faqs.map((f) => (
              <details key={f.q} className="group p-6">
                <summary className="cursor-pointer flex items-center justify-between text-base font-medium list-none">
                  {f.q}
                  <span className="text-muted-foreground group-open:rotate-45 transition-transform text-2xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </FadeUp>
      </section>
    </SiteLayout>
  );
}