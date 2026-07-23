import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { supabase } from "@/integrations/supabase/client";
import { Phone, Mail, MapPin } from "lucide-react";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — REAL RENTALS" },
      { name: "description", content: "Get in touch about renting, applying, or partnering with REAL RENTALS." },
      { property: "og:title", content: "Contact — REAL RENTALS" },
      { property: "og:description", content: "We're here to help." },
    ],
  }),
  component: Contact,
});

function Contact() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const { error } = await supabase.from("contact_leads").insert(form);
    setLoading(false);
    if (error) setError(error.message); else setSent(true);
  }

  return (
    <SiteLayout>
      <section className="container-real pt-16 md:pt-24 pb-12">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Contact</div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Let's Talk.</h1>
        </FadeUp>
      </section>
      <section className="container-real pb-24 grid grid-cols-1 md:grid-cols-2 gap-12">
        <FadeUp>
          {sent ? (
            <div className="rounded-2xl bg-soft p-10 text-center">
              <h2 className="text-2xl font-semibold">Message Received.</h2>
              <p className="mt-3 text-muted-foreground">We'll be in touch shortly.</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
              <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Message</label>
                <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={5} className="mt-1 w-full bg-soft rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
              </div>
              {error && <div className="text-sm text-real-red">{error}</div>}
              <button disabled={loading} className="rounded-lg bg-black px-7 py-3 text-sm font-medium text-white hover:bg-real-red transition active:scale-95 disabled:opacity-50">
                {loading ? "Sending…" : "Send Message"}
              </button>
            </form>
          )}
        </FadeUp>
        <FadeUp delay={80}>
          <div className="space-y-6">
            <Item I={Phone} label="Phone" v="+1 (813) 699-9118" href="tel:+18136999118" />
            <Item I={Mail} label="Email" v="team@drivereal.com" href="mailto:team@drivereal.com" />
          </div>
        </FadeUp>
      </section>
    </SiteLayout>
  );
}

function Field({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full bg-soft rounded-lg px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
    </div>
  );
}

function Item({ I, label, v, href }: { I: any; label: string; v: string; href?: string }) {
  const valueNode = href ? (
    <a href={href} className="mt-1 font-medium hover:text-real-red transition-colors">{v}</a>
  ) : (
    <div className="mt-1 font-medium">{v}</div>
  );
  return (
    <div className="flex gap-4 items-start">
      <div className="rounded-full bg-soft p-3"><I className="w-5 h-5 text-real-red" strokeWidth={1.75} /></div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        {valueNode}
      </div>
    </div>
  );
}