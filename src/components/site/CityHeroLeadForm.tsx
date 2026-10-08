import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { SmsConsentField } from "@/components/site/SmsConsentField";
import { ArrowRight, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { savePartialApplication } from "@/lib/applications.functions";
import { WelcomeBack, type LinkStatus } from "@/components/site/WelcomeBack";
import { getAvailability, joinWaitlist } from "@/lib/waitlist.functions";
import { getAttribution } from "@/lib/attribution";
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
  const [returning, setReturning] = useState<{ email: string; status: LinkStatus; retryAfterSeconds: number } | null>(null);
  const getAvail = useServerFn(getAvailability);
  const join = useServerFn(joinWaitlist);
  // How many cars the team says are open right now, set in the back office.
  // Unset keeps this form exactly as it always was; 0 switches the card into
  // waitlist mode; above 0 adds a scarcity line. Undefined means still
  // loading, and we render the normal form until we know — no flash of the
  // wrong mode.
  const [availability, setAvailability] = useState<number | null | undefined>(undefined);
  const [joined, setJoined] = useState(false);
  const waitlistMode = availability === 0;
  useEffect(() => {
    let active = true;
    getAvail()
      .then((r) => {
        if (active) setAvailability(r.carsAvailable);
      })
      .catch(() => {
        if (active) setAvailability(null);
      });
    return () => {
      active = false;
    };
  }, []);
  // honeypot
  const [hp, setHp] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    pickup_date: "",
    sms_consent: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Attribution (gclid + utm_* + landing_page + referrer) is captured
  // sessionStorage-first in __root and read here at submit time so it
  // survives navigation.

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!z.string().min(2).safeParse(form.full_name).success) next.full_name = "Required";
    if (!z.string().email().safeParse(form.email).success) next.email = "Invalid Email";
    if (!/^\d{7,}$/.test(form.phone.replace(/\D/g, ""))) next.phone = "Invalid Phone";
    if (!form.pickup_date) next.pickup_date = "Required";
    // SMS consent is optional and never blocks submission.
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
    const shared = {
      full_name: form.full_name,
      phone: form.phone,
      email: form.email,
      pickup_date: form.pickup_date || null,
      market_id: site.market_id,
      city: market?.name ?? site.title,
      state: market?.state ?? null,
      ...getAttribution(),
    };
    try {
      if (waitlistMode) {
        // No cars right now: collect a waitlist spot instead of an
        // application. Queue positions stay internal — never shown here.
        const res = await join({ data: { ...shared, source: "fleet_waitlist" } });
        if (res.ok) {
          setJoined(true);
          toast.success("You're on the waitlist — we'll email you as soon as a car opens up.");
        } else {
          toast.error(res.error ?? "Could not join the waitlist. Please try again.");
        }
        return;
      }
      const payload = {
        ...shared,
        sms_consent: form.sms_consent,
        consent_page: typeof window !== "undefined" ? window.location.pathname : null,
        source: "city_lp" as const,
      };
      const data = await saveApplication({ data: payload });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lead", { detail: { city: site.slug, applicationId: data.id } }));
      }
      if (!data.token) {
        // We matched an application that already exists. The link goes to the
        // address on that record, not to whoever filled this form in.
        setReturning({ email: form.email, status: data.linkStatus ?? "sent", retryAfterSeconds: data.retryAfterSeconds ?? 120 });
        return;
      }
      navigate({ to: "/thank-you", search: { t: data.token } });
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
            {returning !== null ? (
              <WelcomeBack email={returning.email} initial={returning} onBack={() => setReturning(null)} />
            ) : joined ? (
              <div className="py-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-real-red/10">
                  <Check className="h-6 w-6 text-real-red" />
                </div>
                <h2 className="mt-4 text-2xl font-semibold">You're on the List</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  We'll email you the moment a car opens up in {market?.name ?? site.title}. Cars go
                  to the next person on the list first — no deposit or obligation while you wait.
                </p>
              </div>
            ) : (
              <>
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-real-red">
                  {waitlistMode ? "Waitlist" : "Step 1 Of 3"}
                </div>
                <h2 className="mt-2 text-2xl font-semibold">
                  {waitlistMode ? "Join The Waitlist" : "Get My Quote"}
                </h2>
                {availability !== undefined && availability !== null && availability > 0 && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-real-red/10 px-3 py-1 text-[11px] font-semibold text-real-red">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-real-red opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-real-red" />
                    </span>
                    Only {availability} {availability === 1 ? "car" : "cars"} available in{" "}
                    {market?.name ?? site.title} right now
                  </div>
                )}
                {/* honeypot */}
                <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="hidden" aria-hidden />
                <div className="mt-6 grid grid-cols-1 gap-4">
                  <Field label="Full Name" value={form.full_name} error={errors.full_name} onChange={(value) => update("full_name", value)} />
                  <Field label="Phone" value={form.phone} error={errors.phone} onChange={(value) => update("phone", value)} />
                  <Field label="Email" type="email" value={form.email} error={errors.email} onChange={(value) => update("email", value)} />

                  {/* Pick-up only. A return date here was an exact contractual
                      date guessed by somebody who had not been quoted a rate yet;
                      the wizard asks how long they expect to need the car
                      instead. */}
                  <Field
                    label="When Do You Want To Start?"
                    type="date"
                    min={today}
                    value={form.pickup_date}
                    error={errors.pickup_date}
                    onChange={(value) => update("pickup_date", value)}
                  />
                </div>

                {waitlistMode ? (
                  <p className="mt-5 text-[11px] leading-snug text-muted-foreground">
                    No cars are available right now, so we're taking a waitlist. You'll get an email
                    the moment it's your turn — before the car is offered to anyone else.
                  </p>
                ) : (
                  <>
                    <SmsConsentField className="mt-5" checked={form.sms_consent} onChange={(v) => update("sms_consent", v)} />
                  </>
                )}

                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="mt-7 inline-flex w-full items-center justify-center rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                >
                  {submitting
                    ? waitlistMode
                      ? "Joining…"
                      : "Saving…"
                    : waitlistMode
                      ? "Join The Waitlist"
                      : "Continue"}
                </button>
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  By submitting, you agree to our{" "}
                  <Link to="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
                  <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
                </p>
              </>
            )}
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
