import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — REAL RENTALS" },
      { name: "description", content: "Weekly rideshare & delivery rentals. No credit check, no deposit, unlimited miles. Answers on approvals, payments, platforms, maintenance, and returns." },
      { property: "og:title", content: "FAQ — REAL RENTALS" },
      { property: "og:description", content: "Everything you need to know before applying." },
    ],
  }),
  component: FAQ,
});

const faqGroups: { title: string; items: { q: string; a: string }[] }[] = [
  {
    title: "Getting Approved",
    items: [
      { q: "What is required to get approved?", a: "You must be 21+, hold a valid US driver's license for at least one year, have a reasonably clean driving record, and a payment method for weekly rent. No credit check required." },
      { q: "How quickly can I get approved?", a: "Most applications are reviewed the same day, and most drivers are on the road within 24 hours of applying." },
      { q: "Do you check credit?", a: "No credit check. Approval is based on your license, driving record, and an active payment card in your name." },
      { q: "Can I let someone else drive the car?", a: "No. You are the only authorized driver on the rental agreement. Unauthorized drivers void coverage and violate the agreement." },
    ],
  },
  {
    title: "Payments & Costs",
    items: [
      { q: "How can I pay?", a: "Weekly rent is auto-paid from a bank-issued debit or credit card in your name — Chime and Cash App Card work great. The name on your card must match your driver's license. We do not accept cash, anonymous prepaid or gift cards, or cards without a printed name. No bank account? Load cash onto a Cash App or Chime card at most major retailers and you're ready to go." },
      { q: "Is a security deposit required?", a: "No. We do not collect a security deposit. We do require a valid payment card on file to cover tolls, citations, damage, cleaning, and unpaid rent per your rental agreement." },
      { q: "What is included in the weekly payment?", a: "Routine maintenance, unlimited miles, and 24/7 driver support. You handle fuel, cleanliness, and your own auto insurance (rideshare/delivery coverage as applicable)." },
      { q: "Who pays for tolls and tickets?", a: "You do. Any tolls, tickets, or citations during your rental are your responsibility. Unpaid items are transferred to the driver on record per your rental agreement, and an admin fee may apply per notice." },
    ],
  },
  {
    title: "Insurance & Platforms",
    items: [
      { q: "Do I need my own insurance?", a: "Yes. Drivers maintain their own auto insurance with rideshare or delivery coverage as applicable. Our team will explain exactly what's required on your qualification call and can point you to gig-friendly options." },
      { q: "Can I drive for Uber and Lyft?", a: "Yes. Every vehicle is eligible for Uber and Lyft, and you can run both platforms on the same car." },
      { q: "Can I use the vehicle for DoorDash and Instacart?", a: "Yes. Delivery platforms including DoorDash, Instacart, Uber Eats, and Amazon Flex are all permitted on the same vehicle." },
    ],
  },
  {
    title: "Maintenance & Support",
    items: [
      { q: "Are maintenance and repairs included?", a: "Yes. Routine maintenance and most mechanical repairs are on us — oil changes, brakes, tires, and scheduled service." },
      { q: "What happens if my vehicle needs repairs?", a: "Contact support, schedule a swap or service appointment, and we'll get you back on the road quickly. Most routine work is covered." },
    ],
  },
  {
    title: "Returns & Policies",
    items: [
      { q: "What is the minimum rental period?", a: "One week. Rent is billed weekly on the same day of the week you picked up, and you can keep the vehicle as long as you need — week to week, no long-term contract." },
      { q: "How do I return my vehicle?", a: "Just give us 7 days' notice through your driver portal, by text, or by phone, and return the vehicle during office hours. Unscheduled returns without notice carry a $50 fee per the rental agreement." },
      { q: "Can I take the car out of state?", a: "Limited out-of-state driving is allowed with prior approval. Unauthorized travel triggers a fee." },
    ],
  },
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
        <div className="max-w-3xl mx-auto space-y-10">
          {faqGroups.map((group) => (
            <FadeUp key={group.title}>
              <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase mb-4">{group.title}</div>
              <div className="divide-y divide-border rounded-2xl border border-border">
                {group.items.map((f) => (
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
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}