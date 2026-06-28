import { useState, useMemo } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { submitApplication } from "@/lib/applications.functions";
import { FadeUp } from "./FadeUp";
import heroBg from "@/assets/hero-bg.jpg";

const PLATFORM_STATUSES = ["Yes", "Pending", "Not Yet"] as const;

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
}: {
  site: Site;
  market: Market | null;
  eyebrow: string;
  headline: string;
  subhead: React.ReactNode;
}) {
  const navigate = useNavigate();
  const saveApplication = useServerFn(submitApplication);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    platform_status: "",
    sms_consent: false,
    terms_accepted: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

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
    if (!form.platform_status) next.platform_status = "Required";
    if (!form.sms_consent) next.sms_consent = "Required";
    if (!form.terms_accepted) next.terms_accepted = "Required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  async function submit() {
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setSubmitting(true);
    const payload = {
      full_name: form.full_name,
      phone: form.phone,
      email: form.email,
      platform_status: form.platform_status as "Yes" | "Pending" | "Not Yet",
      market_id: site.market_id,
      city: market?.name ?? site.title,
      state: market?.state ?? null,
      sms_consent: form.sms_consent,
      source: "city_lp",
      ...utms,
    };
    try {
      const data = await saveApplication({ data: payload });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lead", { detail: { city: site.slug, applicationId: data.id } }));
      }
      navigate({ to: "/apply/step2", search: { id: data.id } });
    } catch (error: any) {
      toast.error(error?.message || "Could not submit your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="relative isolate overflow-hidden px-6 md:px-12 pt-24 md:pt-32 pb-14 md:pb-20 text-center text-white">
      <div aria-hidden className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: `url(${heroBg})` }} />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/75 via-black/60 to-black/85" />
      <FadeUp>
        <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">{eyebrow}</div>
        <h1 className="mt-4 text-[40px] md:text-[72px] leading-[1.02] font-semibold text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
          {headline}
        </h1>
        <p className="mt-5 text-base md:text-xl text-white/85 max-w-3xl mx-auto leading-relaxed whitespace-pre-line">
          {subhead}
        </p>
      </FadeUp>

      <FadeUp delay={80}>
        <div className="mt-10 max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl shadow-black/40 p-5 md:p-6 text-left text-foreground">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-real-red">Step 1 Of 2</div>
          <h2 className="mt-2 text-2xl font-semibold">Get My Quote</h2>
          <div className="mt-6 grid grid-cols-1 gap-4">
            <Field label="Full Name" value={form.full_name} error={errors.full_name} onChange={(value) => update("full_name", value)} />
            <Field label="Phone" value={form.phone} error={errors.phone} onChange={(value) => update("phone", value)} />
            <Field label="Email" type="email" value={form.email} error={errors.email} onChange={(value) => update("email", value)} />

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Are You Already Active On A Gig App?</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PLATFORM_STATUSES.map((status) => {
                  const active = form.platform_status === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => update("platform_status", status)}
                      className={`rounded-lg border px-5 py-2 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
                    >
                      {status}
                    </button>
                  );
                })}
              </div>
              {errors.platform_status && <div className="mt-2 text-sm text-real-red">{errors.platform_status}</div>}
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

          <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.terms_accepted}
              onChange={(e) => update("terms_accepted", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-real-red shrink-0"
            />
            <span className="text-[11px] leading-snug text-muted-foreground">
              I agree to the{" "}
              <Link to="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
              <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </span>
          </label>
          {errors.terms_accepted && <div className="mt-2 text-sm text-real-red">{errors.terms_accepted}</div>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="mt-7 inline-flex w-full items-center justify-center rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </div>
      </FadeUp>
    </section>
  );
}

function Field({
  label,
  value,
  error,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm ${error ? "border-real-red" : "border-border"}`}
      />
      {error && <div className="mt-1 text-xs text-real-red">{error}</div>}
    </label>
  );
}
