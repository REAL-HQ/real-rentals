import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — REAL AUTOMOTIVE" },
      { name: "description", content: "Answers about insurance, mileage, no-deposit policy, tolls, maintenance, payments, and platform deactivation." },
      { property: "og:title", content: "FAQ — REAL AUTOMOTIVE" },
      { property: "og:description", content: "Everything you need to know before applying." },
    ],
  }),
  component: FAQ,
});

const faqs = [
  { q: "What is required to get approved?", a: "You must be 21+, hold a valid US driver's license for at least one year, have a reasonably clean driving record, and a payment method for weekly rent. No credit check required." },
  { q: "Is a security deposit required?", a: "No. We do not collect a security deposit. We do require a valid payment card on file to cover tolls, citations, damage, cleaning, and unpaid rent per your rental agreement." },
  { q: "What is included in the weekly payment?", a: "Routine maintenance, unlimited miles, and 24/7 driver support are all included. Insurance options are available — our team will walk you through what's included before you sign. You handle fuel and cleanliness." },
  { q: "Can I drive for Uber and Lyft?", a: "Yes. Every vehicle is eligible for Uber and Lyft, and you can run both platforms on the same car." },
  { q: "Are maintenance and repairs included?", a: "Yes. Routine maintenance and most mechanical repairs are on us — oil changes, brakes, tires, and scheduled service." },
  { q: "How quickly can I get approved?", a: "Most applications are reviewed the same day, and many drivers pick up the same day or within 24 to 48 hours of applying." },
  { q: "Is insurance included?", a: "Insurance options are available with every rental. Our team will walk you through what's included and any limitations before you sign." },
  { q: "Who pays for tolls and tickets?", a: "You do. Any tolls, tickets, or citations during your rental are your responsibility. Unpaid items are transferred to the driver on record per your rental agreement, and an admin fee may apply per notice." },
  { q: "Can I use the vehicle for DoorDash and Instacart?", a: "Yes. Delivery platforms including DoorDash, Instacart, Uber Eats, and Amazon Flex are all permitted on the same vehicle." },
  { q: "What happens if my vehicle needs repairs?", a: "Contact support, schedule a swap or service appointment, and we'll get you back on the road quickly. Most routine work is covered." },
  { q: "How do fleet partners earn money?", a: "Partners place vehicles into the REAL Automotive fleet and earn passive monthly income on a 50/50 split of rent collected. We handle driver acquisition, screening, collections, GPS tracking, and maintenance." },
  { q: "How do I pay weekly rent?", a: "Debit, credit, or Cash App. Rent is paid in advance every week via auto-pay." },
  { q: "Can I take the car out of state?", a: "Limited out-of-state driving is allowed with prior approval. Unauthorized travel triggers a fee." },
];

function FAQ() {
  return (
    <SiteLayout>
      <section className="container-real pt-16 md:pt-24 pb-12 text-center">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">FAQ</div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Questions, Answered.</h1>
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