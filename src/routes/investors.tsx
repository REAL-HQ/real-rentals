import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { supabase } from "@/integrations/supabase/client";
import { Shield, TrendingUp, Wrench, MapPin } from "lucide-react";

export const Route = createFileRoute("/investors")({
  head: () => ({
    meta: [
      { title: "Investors — REAL AUTOMOTIVE" },
      { name: "description", content: "Own the asset, we run the operation. Earn passive monthly income from rideshare fleet vehicles." },
      { property: "og:title", content: "Own The Asset. We Run The Operation." },
      { property: "og:description", content: "Place vehicles in the REAL AUTOMOTIVE fleet and earn passive income. 50/50 split." },
    ],
  }),
  component: Investors,
});

const VEHICLE_TYPES = ["Sedan", "SUV", "Minivan", "Hybrid", "EV"];

function Investors() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", capital_range: "", vehicles_interested: 1, vehicle_types: [] as string[], message: "" });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { vehicle_types, ...rest } = form;
    const payload = { ...rest, message: [vehicle_types.length ? `Vehicle types: ${vehicle_types.join(", ")}` : "", rest.message].filter(Boolean).join("\n\n") };
    const { error } = await supabase.from("investor_leads").insert(payload);
    if (error) setErr(error.message); else setSent(true);
  }

  return (
    <SiteLayout>
      <section className="container-real pt-20 md:pt-28 pb-16 text-center">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Investors</div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold max-w-3xl mx-auto">
            Own The Asset.
            <br />
            We Run The Operation.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Place vehicles into the REAL AUTOMOTIVE fleet and earn passive monthly income.
            We find the drivers, screen them, collect rent, and handle maintenance and
            recovery — you own the car, we do the work.
          </p>
        </FadeUp>
      </section>

      <section className="bg-soft py-20">
        <div className="container-real grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-7">
          {[
            { I: TrendingUp, t: "50/50 Profit Split", d: "Simple, transparent revenue share on every dollar of rent collected." },
            { I: Shield, t: "We Screen Drivers", d: "Background, MVR, identity, and platform checks on every applicant." },
            { I: MapPin, t: "Fleet Recovery", d: "Recovery support and asset protection included." },
            { I: Wrench, t: "Full-Service Ops", d: "Maintenance, registration, claims, and collections — handled." },
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
      </section>

      <section className="container-real py-20">
        <div className="max-w-2xl mx-auto">
          <FadeUp>
            <h2 className="text-3xl md:text-4xl font-semibold">Request The Investor Deck</h2>
            <p className="mt-3 text-muted-foreground">Tell us a bit about you and we'll send the JV details.</p>
          </FadeUp>
          {sent ? (
            <div className="mt-8 rounded-2xl bg-soft p-10 text-center">
              <h3 className="text-2xl font-semibold">Thanks.</h3>
              <p className="mt-3 text-muted-foreground">A partner will be in touch within one business day.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              <I label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <I label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
              <I label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Capital range</label>
                <div className="relative mt-1">
                <select value={form.capital_range} onChange={(e) => setForm({ ...form, capital_range: e.target.value })} className="appearance-none w-full bg-soft rounded-lg pl-5 pr-12 py-3 text-sm">
                  <option style={{ background: "#fff" }} value="">Select…</option>
                  <option style={{ background: "#fff" }}>$5k – $25k</option>
                  <option style={{ background: "#fff" }}>$25k – $50k</option>
                  <option style={{ background: "#fff" }}>$50k – $150k</option>
                  <option style={{ background: "#fff" }}>$150k – $500k</option>
                  <option style={{ background: "#fff" }}>$500k+</option>
                </select>
                <svg className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              </div>
              <I label="Vehicles interested" type="number" value={String(form.vehicles_interested)} onChange={(v) => setForm({ ...form, vehicles_interested: Number(v) })} />
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Vehicle types <span className="normal-case tracking-normal text-muted-foreground/70">(optional)</span></label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {VEHICLE_TYPES.map((t) => {
                    const active = form.vehicle_types.includes(t);
                    return (
                      <button
                        type="button"
                        key={t}
                        onClick={() => setForm({ ...form, vehicle_types: active ? form.vehicle_types.filter((x) => x !== t) : [...form.vehicle_types, t] })}
                        className={`rounded-full px-4 py-1.5 text-xs border transition ${active ? "bg-real-red text-white border-real-red" : "bg-white text-foreground border-border hover:border-foreground/40"}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Message</label>
                <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={4} className="mt-1 w-full bg-soft rounded-2xl px-4 py-3 text-sm" />
              </div>
              {err && <div className="md:col-span-2 text-sm text-real-red">{err}</div>}
              <div className="md:col-span-2">
                <button className="rounded-lg bg-real-red px-7 py-3 text-sm font-medium text-white hover:opacity-90 transition active:scale-95">Request Deck</button>
              </div>
            </form>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}

function I({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full bg-soft rounded-lg px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
    </div>
  );
}