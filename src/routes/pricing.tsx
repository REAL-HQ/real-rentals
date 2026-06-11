import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { Check } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — REAL AUTOMOTIVE" },
      { name: "description", content: "Transparent weekly, monthly, and long-term rental pricing. From $350/week, deposits from $249." },
      { property: "og:title", content: "Pricing — REAL AUTOMOTIVE" },
      { property: "og:description", content: "Three simple tiers. No hidden fees." },
    ],
  }),
  component: Pricing,
});

const tiers = [
  { name: "Weekly", price: "350", period: "/week", note: "Flexible. Cancel any time.", features: ["Insurance included", "Unlimited rideshare/delivery miles", "Maintenance handled", "Weekly auto-pay"] },
  { name: "Monthly", price: "1,300", period: "/month", popular: true, note: "Save ~$100 vs weekly.", features: ["Everything in Weekly", "Discounted rate", "Priority support", "Lock in your vehicle"] },
  { name: "Long-Term", price: "Best", period: "rate", note: "Annual commitment. Best price.", features: ["Everything in Monthly", "Largest discount", "Vehicle swap eligible", "Concierge onboarding"] },
];

const fees = [
  ["Late payment", "$50"],
  ["Additional driver", "$25/week"],
  ["Interior cleaning", "$75"],
  ["Smoking violation", "$250"],
  ["Unauthorized out-of-state", "$100"],
];

function Pricing() {
  return (
    <SiteLayout>
      <section className="container-real pt-16 md:pt-24 pb-12 text-center">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Pricing</div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Pick A Plan. Pay Weekly. Drive Today.</h1>
        </FadeUp>
      </section>

      <section className="container-real py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
          {tiers.map((t, i) => (
            <FadeUp key={t.name} delay={i * 70}>
              <div className={`rounded-2xl p-8 h-full border ${t.popular ? "border-real-red bg-white shadow-lg" : "border-border bg-soft"}`}>
                {t.popular && <div className="text-[10px] uppercase tracking-widest text-real-red font-semibold mb-3">Most Popular</div>}
                <div className="text-xl font-semibold">{t.name}</div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-5xl font-semibold">${t.price}</span>
                  <span className="text-muted-foreground text-sm">{t.period}</span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{t.note}</div>
                <ul className="mt-6 space-y-3 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-real-red mt-0.5" />{f}</li>
                  ))}
                </ul>
                <Link to="/apply" className={`mt-8 inline-flex w-full justify-center rounded-lg px-6 py-3 text-sm font-medium transition active:scale-95 ${t.popular ? "bg-real-red text-white hover:opacity-90" : "bg-black text-white hover:bg-real-red"}`}>
                  Apply Now
                </Link>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      <section className="container-real py-16">
        <FadeUp>
          <div className="rounded-2xl bg-soft p-8 md:p-10">
            <h3 className="text-2xl font-semibold">Deposit</h3>
            <p className="mt-3 text-muted-foreground max-w-2xl">
              A refundable deposit of $249–$500 is required at pickup, held for 14–30 days
              after the rental ends to cover any tolls, tickets, or damage.
            </p>
          </div>
        </FadeUp>
      </section>

      <section className="container-real pb-24">
        <FadeUp>
          <h3 className="text-2xl font-semibold mb-6">Transparent fees</h3>
          <div className="rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {fees.map(([k, v]) => (
                  <tr key={k} className="border-b border-border last:border-0">
                    <td className="p-4">{k}</td>
                    <td className="p-4 text-right font-medium">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeUp>
      </section>
    </SiteLayout>
  );
}