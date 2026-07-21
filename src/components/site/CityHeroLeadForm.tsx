import { useState, useMemo, useRef } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { savePartialApplication } from "@/lib/applications.functions";
import { FadeUp } from "./FadeUp";
import heroBg from "@/assets/hero-bg.jpg";

type Site = {
  id: string;
  slug: string;
  title: string;
  market_id: string | null;
};

type Market = { id: string; name: string; state: string | null; slug: string };

export function CityHeroLeadForm({
  site,
  market,
  eyebrow,
  headline,
  subhead,
  id,
  ctaLabel = "Get My Quote",
}: {
  site: Site;
  market: Market | null;
  eyebrow: string;
  headline: string;
  subhead: React.ReactNode;
  id?: string;
  ctaLabel?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const scrollToCard = () => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const navigate = useNavigate();
  const saveApplication = useServerFn(savePartialApplication);
  // honeypot
  const [hp, setHp] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    pickup_date: "",
    return_date: "",
    sms_consent: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

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

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!z.string().min(2).safeParse(form.full_name).success) next.full_name = "Required";
    if (!z.string().email().safeParse(form.email).success) next.email = "Invalid Email";
    if (!/^\d{7,}$/.test(form.phone.replace(/\D/g, ""))) next.phone = "Invalid Phone";
    if (!form.pickup_date) next.pickup_date = "Required";
    if (!form.return_date) next.return_date = "Required";
    if (form.pickup_date && form.return_date && form.return_date <= form.pickup_date) {
      next.return_date = "Must be after pick up date";
    }
    if (!form.sms_consent) next.sms_consent = "Required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  async function submit() {
    if (hp) return; // bot
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setSubmitting(true);
    const payload = {
      full_name: form.full_name,
      phone: form.phone,
      email: form.email,
      pickup_date: form.pickup_date || null,
      return_date: form.return_date || null,
      market_id: site.market_id,
      city: market?.name ?? site.title,
      state: market?.state ?? null,
      sms_consent: form.sms_consent,
      source: "city_lp" as const,
      ...utms,
    };
    try {
      const data = await saveApplication({ data: payload });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lead", { detail: { city: site.slug, applicationId: data.id } }));
      }
      navigate({ to: "/thank-you", search: { id: data.id } });
    } catch (error: any) {
      toast.error(error?.message || "Could not submit your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id={id} className="relative isolate overflow-hidden flex min-h-[620px] md:min-h-[88vh] items-center px-6 md:px-12 pt-24 md:pt-32 pb-10 md:pb-16 text-white">
      <div aria-hidden className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: `url(${heroBg})` }} />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/80 via-black/15 to-black/90" />

      <div className="relative z-10 mx-auto w-full max-w-7xl grid grid-cols-1 lg:grid-cols-[1fr_minmax(380px,420px)] gap-10 lg:gap-16 items-center">
        <FadeUp className="text-center lg:text-left">
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">{eyebrow}</div>
          <h1 className="mt-4 text-[40px] md:text-[56px] lg:text-[64px] leading-[1.02] font-semibold text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
            {headline}
          </h1>
          <p className="mt-5 text-base md:text-xl text-white/85 max-w-3xl mx-auto lg:mx-0 leading-relaxed whitespace-pre-wrap">
            {subhead}
          </p>
          <button
            type="button"
            onClick={scrollToCard}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-real-red px-8 py-4 text-sm font-semibold text-white transition hover:opacity-90 active:scale-95"
          >
            {ctaLabel} <ArrowRight className="h-4 w-4" />
          </button>
        </FadeUp>

        <FadeUp delay={80} className="w-full">
          <div ref={cardRef} className="bg-white rounded-2xl shadow-2xl shadow-black/40 p-5 md:p-6 text-left text-foreground">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-real-red">Step 1 Of 5</div>
            <h2 className="mt-2 text-2xl font-semibold">Get My Quote</h2>
            {/* honeypot */}
            <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="hidden" aria-hidden />
            <div className="mt-6 grid grid-cols-1 gap-4">
              <Field label="Full Name" value={form.full_name} error={errors.full_name} onChange={(value) => update("full_name", value)} />
              <Field label="Phone" value={form.phone} error={errors.phone} onChange={(value) => update("phone", value)} />
              <Field label="Email" type="email" value={form.email} error={errors.email} onChange={(value) => update("email", value)} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Pick Up Date"
                  type="date"
                  min={today}
                  value={form.pickup_date}
                  error={errors.pickup_date}
                  onChange={(value) => update("pickup_date", value)}
                />
                <Field
                  label="Return Date"
                  type="date"
                  min={form.pickup_date || today}
                  value={form.return_date}
                  error={errors.return_date}
                  onChange={(value) => update("return_date", value)}
                />
              </div>
            </div>

            <label className="mt-5 flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.sms_consent}
                onChange={(e) => update("sms_consent", e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-real-red shrink-0"
              />
              <span className="text-[11px] leading-snug text-muted-foreground">
                By checking this box, I agree to receive SMS text messages from REAL RENTALS about my application, rental updates, and scheduling at the number provided. Message and data rates may apply. Reply STOP to opt out. See our{" "}
                <Link to="/sms-consent" className="underline hover:text-foreground">SMS Consent</Link> and{" "}
                <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
              </span>
            </label>
            {errors.sms_consent && <div className="mt-2 text-sm text-real-red">{errors.sms_consent}</div>}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-7 inline-flex w-full items-center justify-center rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Continue"}
            </button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              By submitting, you agree to our{" "}
              <Link to="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
              <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  error,
  onChange,
  type = "text",
  min,
  max,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: string;
  min?: string;
  max?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm ${error ? "border-real-red" : "border-border"}`}
      />
      {error && <div className="mt-1 text-xs text-real-red">{error}</div>}
    </label>
  );
}
