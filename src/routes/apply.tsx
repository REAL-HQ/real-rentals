import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Nav } from "@/components/site/Nav";
import { FadeUp } from "@/components/site/FadeUp";
import { ApplicationWizard } from "@/components/site/ApplicationWizard";
import { savePartialApplication } from "@/lib/applications.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/apply")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: (s.id as string) || "",
    city: (s.city as string) || "",
    pickup: (s.pickup as string) || "",
    return: (s.return as string) || "",
  }),
  head: () => ({
    meta: [
      { title: "Apply — REAL RENTALS" },
      { name: "description", content: "Complete your driver application — quick, no payment required." },
      { property: "og:title", content: "Apply — REAL RENTALS" },
      { property: "og:description", content: "Complete your driver application — quick, no payment required." },
    ],
  }),
  component: ApplyPage,
});

function ApplyPage() {
  const { id, city: preCity, pickup: prePickup, return: preReturn } = Route.useSearch();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1">
        <section id="quote-form" className="pt-12 md:pt-20 pb-24 mx-auto px-6 w-full max-w-[1600px]">
          {id ? (
            <ApplicationWizard id={id} />
          ) : (
            <ContactStep preCity={preCity} prePickup={prePickup} preReturn={preReturn} />
          )}
        </section>
      </main>
    </div>
  );
}

function ContactStep({ preCity, prePickup, preReturn }: { preCity: string; prePickup: string; preReturn: string }) {
  const navigate = useNavigate();
  const savePartial = useServerFn(savePartialApplication);
  const [submitting, setSubmitting] = useState(false);
  const [hp, setHp] = useState("");
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", sms_consent: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [market, setMarket] = useState<{ id: string; name: string; state: string | null } | null>(null);

  useEffect(() => {
    if (!preCity) return;
    supabase
      .from("sites")
      .select("market_id, markets(name, state)")
      .eq("slug", preCity)
      .eq("is_published", true)
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.market_id) return;
        const m = data.markets as { name: string; state: string | null } | null;
        setMarket({ id: data.market_id, name: m?.name ?? preCity, state: m?.state ?? null });
      });
  }, [preCity]);

  const utms = useMemo(() => {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_term: params.get("utm_term"),
      utm_content: params.get("utm_content"),
      gclid: params.get("gclid"),
    };
  }, []);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!z.string().min(2).safeParse(form.full_name).success) e.full_name = "Required";
    if (!z.string().email().safeParse(form.email).success) e.email = "Invalid email";
    if (!/^\d{7,}$/.test(form.phone.replace(/\D/g, ""))) e.phone = "Invalid phone";
    if (!form.sms_consent) e.sms_consent = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (hp) return;
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setSubmitting(true);
    try {
      const data = await savePartial({
        data: {
          full_name: form.full_name,
          phone: form.phone,
          email: form.email,
          sms_consent: form.sms_consent,
          market_id: market?.id ?? null,
          city: market?.name ?? preCity ?? null,
          state: market?.state ?? null,
          pickup_date: prePickup || null,
          return_date: preReturn || null,
          source: "homepage",
          ...utms,
        },
      });
      navigate({ to: "/apply", search: { id: data.id, city: "", pickup: "", return: "" } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FadeUp>
      <div className="max-w-xl mx-auto">
        <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase mb-3">Step 1 Of 5</div>
        <h1 className="text-3xl md:text-4xl font-semibold">Tell Us How To Reach You</h1>
        <p className="mt-3 text-muted-foreground">We'll save your spot and call you shortly.</p>

        <div className="mt-8 rounded-2xl bg-soft p-6 md:p-8">
          <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="hidden" aria-hidden />
          <div className="grid grid-cols-1 gap-5">
            <In label="Full Name" v={form.full_name} e={errors.full_name} on={(v) => update("full_name", v)} />
            <In label="Email" type="email" v={form.email} e={errors.email} on={(v) => update("email", v)} />
            <In label="Phone" v={form.phone} e={errors.phone} on={(v) => update("phone", v)} />
          </div>

          <label className="mt-5 flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.sms_consent}
              onChange={(e) => update("sms_consent", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-real-red shrink-0"
            />
            <span className="text-[11px] leading-snug text-muted-foreground">
              By checking this box, I agree to receive SMS text messages from REAL RENTALS about my application, rental updates, and scheduling at the number provided. Msg & data rates may apply. Reply STOP to opt out. See our{" "}
              <Link to="/sms-consent" className="underline hover:text-foreground">SMS Consent</Link> and{" "}
              <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </span>
          </label>
          {errors.sms_consent && <div className="mt-2 text-sm text-real-red">{errors.sms_consent}</div>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="mt-8 w-full inline-flex items-center justify-center rounded-lg bg-real-red text-white px-6 py-3 text-sm font-semibold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            By submitting, you agree to our{" "}
            <Link to="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
            <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </FadeUp>
  );
}

function In({ label, type = "text", v, e, on }: { label: string; type?: string; v: string; e?: string; on: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(ev) => on(ev.target.value)}
        className={`mt-1 w-full bg-white border ${e ? "border-real-red" : "border-border"} rounded-lg px-3 py-2 text-sm`}
      />
      {e && <div className="mt-1 text-xs text-real-red">{e}</div>}
    </label>
  );
}