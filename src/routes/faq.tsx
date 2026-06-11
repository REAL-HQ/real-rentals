import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — REAL AUTOMOTIVE" },
      { name: "description", content: "Answers about insurance, mileage, deposits, maintenance, GPS, payments, and platform deactivation." },
      { property: "og:title", content: "FAQ — REAL AUTOMOTIVE" },
      { property: "og:description", content: "Everything you need to know before applying." },
    ],
  }),
  component: FAQ,
});

const faqs = [
  { q: "Is insurance included?", a: "Yes. Every REAL AUTOMOTIVE vehicle comes with commercial rideshare insurance that covers you while driving for approved platforms." },
  { q: "What's the mileage limit?", a: "Unlimited miles for rideshare and delivery driving. Personal use should be reasonable." },
  { q: "How big is the deposit?", a: "Refundable deposits run $249–$500 depending on vehicle, and are held 14–30 days after rental ends to cover tolls or tickets." },
  { q: "Who handles maintenance?", a: "We do. Oil changes, brakes, tires, and routine service are on us. You handle fuel and cleanliness." },
  { q: "Is there a GPS device?", a: "Yes. Every vehicle has a GPS tracker for security and recovery. You consent to this in the application." },
  { q: "How do I pay weekly rent?", a: "Debit, credit, or Cash App. Rent is paid in advance every week via auto-pay." },
  { q: "What if I get deactivated from Uber or Lyft?", a: "You can drive for any approved platform (Lyft, DoorDash, Instacart, Amazon Flex, etc.). If you can no longer drive any platform, contact us — we'll work with you to return the vehicle." },
  { q: "How fast is approval?", a: "Most drivers are reviewed within 24 hours and on the road within 48–72 hours of applying." },
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