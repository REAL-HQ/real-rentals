import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Phone, ArrowRight, MapPin, Check, Pencil, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { submitApplication } from "@/lib/applications.functions";
import { Logo } from "./Logo";
import heroCar from "@/assets/hero-economy-car.png.asset.json";

export type QuoteLocation = {
  id: string;
  slug: string;
  title: string;
  market_id: string | null;
  status: string;
  name: string;
  state: string | null;
  sort_order?: number;
};

type QuoteHeroProps =
  | {
      mode: "homepage";
      locations: QuoteLocation[];
      headline: string;
      subhead: string;
    }
  | {
      mode: "city";
      city: QuoteLocation;
      headline: string;
      subhead: string;
    };

const PLATFORM_STATUSES = ["Yes", "Pending", "Not Yet"] as const;
type PlatformStatus = (typeof PLATFORM_STATUSES)[number];

const PHONE_NUMBER = "(813) 555-0100";
const PHONE_HREF = "tel:+18135550100";

export function QuoteHero(props: QuoteHeroProps) {
  return (
    <section className="relative isolate overflow-hidden bg-[#0a0a0a] text-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-black"
      />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/30 via-transparent to-black/40" />

      <div className="container-real">
        <HeroTopBar />

        <div className="pt-6 pb-8 md:pt-10 md:pb-12">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-[32px] leading-[1.1] font-semibold text-white md:text-[56px]">
              {props.headline}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-white/80 md:text-lg">
              {props.subhead}
            </p>
          </div>

          <div className="mt-8 md:mt-10 mx-auto max-w-5xl">
            <QuoteWidget {...props} />
          </div>

          <div className="mt-6 md:mt-8 flex flex-col items-center justify-center">
            <img
              src={heroCar.url}
              alt="Clean, fuel-efficient economy sedan — rideshare ready"
              width={1024}
              height={768}
              className="w-full max-w-md md:max-w-2xl object-contain drop-shadow-2xl"
              loading="eager"
            />
            <p className="mt-2 text-xs text-white/60 tracking-wide">
              Clean, Fuel-Efficient Economy Cars — Rideshare Ready.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroTopBar() {
  return (
    <div className="flex items-center justify-between py-4 md:py-5">
      <Logo width={100} offset={false} />
      <div className="flex items-center gap-3 md:gap-4">
        <a
          href={PHONE_HREF}
          className="hidden sm:inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/90 hover:text-white transition"
          aria-label={`Call REAL RENTALS at ${PHONE_NUMBER}`}
        >
          <Phone className="w-4 h-4 text-real-red" strokeWidth={2.25} />
          {PHONE_NUMBER}
        </a>
        <Link
          to="/apply"
          className="inline-flex items-center rounded-lg bg-real-red px-4 py-2 text-[13px] font-semibold text-white hover:bg-real-red/90 transition active:scale-95"
        >
          Book Now
        </Link>
      </div>
    </div>
  );
}

type WidgetState = {
  city: QuoteLocation | null;
  rentalMode: "weekly" | "monthly";
  platformStatus: PlatformStatus | "";
};

function QuoteWidget(props: QuoteHeroProps) {
  const navigate = useNavigate();
  const saveApplication = useServerFn(submitApplication);
  const [expanded, setExpanded] = useState(false);
  const [waitlistCity, setWaitlistCity] = useState<QuoteLocation | null>(null);

  const initialCity = props.mode === "city" ? props.city : null;
  const [widget, setWidget] = useState<WidgetState>({
    city: initialCity,
    rentalMode: "weekly",
    platformStatus: "",
  });

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    sms_consent: false,
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

  const selectedCity = widget.city;
  const isLive = selectedCity?.status === "live";

  function handleGetQuote() {
    if (!selectedCity) {
      toast.error("Please choose a city first.");
      return;
    }
    if (!widget.platformStatus) {
      toast.error("Please select your gig app status.");
      return;
    }
    if (!isLive) {
      setWaitlistCity(selectedCity);
      return;
    }
    setExpanded(true);
  }

  function validateForm() {
    const next: Record<string, string> = {};
    if (!z.string().min(2).safeParse(form.full_name).success) next.full_name = "Required";
    if (!z.string().email().safeParse(form.email).success) next.email = "Invalid Email";
    if (!/^\d{7,}$/.test(form.phone.replace(/\D/g, ""))) next.phone = "Invalid Phone";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleContinue() {
    if (!validateForm() || !selectedCity || !widget.platformStatus) return;
    setSubmitting(true);
    const payload = {
      full_name: form.full_name,
      phone: form.phone,
      email: form.email,
      platform_status: widget.platformStatus,
      rental_length: widget.rentalMode === "weekly" ? "1 Week" : "1 Month",
      rental_term: widget.rentalMode,
      market_id: selectedCity.market_id,
      city: selectedCity.name,
      state: selectedCity.state,
      source: props.mode === "homepage" ? "homepage" : "city_lp",
      sms_consent: form.sms_consent,
      ...utms,
    };
    try {
      const data = await saveApplication({ data: payload });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lead", { detail: { city: selectedCity.slug, applicationId: data.id } }));
      }
      navigate({ to: "/apply/step2", search: { id: data.id } });
    } catch (error: any) {
      toast.error(error?.message || "Could not submit your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="rounded-2xl bg-white p-5 md:p-6 shadow-2xl shadow-black/20 text-foreground">
        {!expanded ? (
          <CollapsedWidget
            {...props}
            widget={widget}
            setWidget={setWidget}
            onGetQuote={handleGetQuote}
          />
        ) : (
          <ExpandedForm
            widget={widget}
            form={form}
            setForm={setForm}
            errors={errors}
            submitting={submitting}
            onBack={() => setExpanded(false)}
            onContinue={handleContinue}
          />
        )}
      </div>

      {waitlistCity && (
        <WaitlistModal city={waitlistCity} onClose={() => setWaitlistCity(null)} />
      )}
    </>
  );
}

function CollapsedWidget({
  mode,
  locations,
  city,
  widget,
  setWidget,
  onGetQuote,
}: {
  mode: "homepage" | "city";
  locations?: QuoteLocation[];
  city?: QuoteLocation;
  widget: WidgetState;
  setWidget: React.Dispatch<React.SetStateAction<WidgetState>>;
  onGetQuote: () => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_auto] gap-3 md:gap-4 items-end">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">City</label>
          {mode === "city" && city ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-soft px-3 py-2.5 text-sm font-semibold">
              <MapPin className="w-4 h-4 text-real-red" />
              {city.name}{city.state ? `, ${city.state}` : ""}
            </div>
          ) : (
            <select
              value={widget.city?.slug ?? ""}
              onChange={(e) => {
                const slug = e.target.value;
                const next = locations?.find((l) => l.slug === slug) || null;
                setWidget((w) => ({ ...w, city: next }));
              }}
              className="mt-2 w-full appearance-none rounded-lg border border-border bg-white px-3 py-2.5 text-sm select-soft"
            >
              <option value="">Select Your City</option>
              {(locations ?? []).map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.name}{l.state ? `, ${l.state}` : ""} {l.status === "live" ? "" : "(Coming Soon)"}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rental Length</label>
          <select
            value={widget.rentalMode}
            onChange={(e) => setWidget((w) => ({ ...w, rentalMode: e.target.value as "weekly" | "monthly" }))}
            className="mt-2 w-full appearance-none rounded-lg border border-border bg-white px-3 py-2.5 text-sm select-soft"
          >
            <option value="weekly">By The Week</option>
            <option value="monthly">By The Month</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Active On A Gig App?</label>
          <select
            value={widget.platformStatus}
            onChange={(e) => setWidget((w) => ({ ...w, platformStatus: e.target.value as PlatformStatus | "" }))}
            className="mt-2 w-full appearance-none rounded-lg border border-border bg-white px-3 py-2.5 text-sm select-soft"
          >
            <option value="">Select</option>
            {PLATFORM_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onGetQuote}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-real-red px-6 py-2.5 text-sm font-semibold text-white hover:bg-real-red/90 transition active:scale-[0.98] whitespace-nowrap"
        >
          Get My Quote <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Quick quote — no deposit, no credit check. We'll confirm your car on a fast call.
      </p>
    </div>
  );
}

function ExpandedForm({
  widget,
  form,
  setForm,
  errors,
  submitting,
  onBack,
  onContinue,
}: {
  widget: WidgetState;
  form: { full_name: string; phone: string; email: string; sms_consent: boolean };
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  errors: Record<string, string>;
  submitting: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const cityLabel = widget.city
    ? `${widget.city.name}${widget.city.state ? `, ${widget.city.state}` : ""}`
    : "";
  return (
    <div className="space-y-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-real-red">Step 1 Of 2</div>
      <h2 className="text-2xl font-semibold">Get My Quote</h2>

      <div className="flex flex-wrap gap-2">
        <ConfirmedChip
          label={cityLabel}
          onEdit={onBack}
        />
        <ConfirmedChip
          label={widget.rentalMode === "weekly" ? "By The Week" : "By The Month"}
          onEdit={onBack}
        />
        <ConfirmedChip
          label={`Active On A Gig App: ${widget.platformStatus}`}
          onEdit={onBack}
          checked
        />
      </div>

      <Field
        label="Full Name"
        value={form.full_name}
        error={errors.full_name}
        onChange={(v) => setForm((f) => ({ ...f, full_name: v }))}
      />
      <Field
        label="Phone"
        value={form.phone}
        error={errors.phone}
        onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
      />
      <Field
        label="Email"
        type="email"
        value={form.email}
        error={errors.email}
        onChange={(v) => setForm((f) => ({ ...f, email: v }))}
      />

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={form.sms_consent}
          onChange={(e) => setForm((f) => ({ ...f, sms_consent: e.target.checked }))}
          className="mt-0.5 h-4 w-4 accent-real-red shrink-0"
        />
        <span className="text-[11px] leading-snug text-muted-foreground">
          By checking this box, I agree to receive SMS text messages from REAL RENTALS about my application, rental updates, and scheduling at the number provided. Message and data rates may apply. Reply STOP to opt out. See our{" "}
          <Link to="/sms-consent" className="underline hover:text-foreground">SMS Consent</Link>{" "}and{" "}
          <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
        </span>
      </label>

      <p className="text-[11px] leading-snug text-muted-foreground">
        By clicking Continue, you agree to our{" "}
        <Link to="/terms" className="underline hover:text-foreground">Terms</Link>{" "}and{" "}
        <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
      </p>

      <button
        type="button"
        onClick={onContinue}
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white hover:bg-real-red/90 transition active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Continue"} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function ConfirmedChip({ label, onEdit, checked }: { label: string; onEdit: () => void; checked?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-soft px-3 py-1.5 text-xs font-medium text-foreground">
      {checked && <Check className="w-3.5 h-3.5 text-green-600" />}
      <span className="truncate max-w-[180px]">{label}</span>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center text-[10px] text-real-red hover:underline"
      >
        <Pencil className="w-3 h-3 mr-0.5" /> Edit
      </button>
    </div>
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
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm ${error ? "border-real-red" : "border-border"}`}
      />
      {error && <div className="mt-1 text-xs text-real-red">{error}</div>}
    </label>
  );
}

function WaitlistModal({ city, onClose }: { city: QuoteLocation; onClose: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [driverStatus, setDriverStatus] = useState<"active" | "pending" | "not_yet" | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName || !email) return toast.error("Name and email required");
    setSubmitting(true);
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const { error } = await supabase.from("waitlist").insert({
      market_id: city.market_id,
      full_name: fullName,
      email,
      phone: phone || null,
      driver_status: driverStatus,
      source: "homepage_waitlist",
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_term: params.get("utm_term"),
      utm_content: params.get("utm_content"),
      gclid: params.get("gclid"),
    } as any);
    setSubmitting(false);
    if (error) return toast.error(error.message);
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "waitlist_signup", { city: city.name });
    }
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md rounded-2xl bg-white p-6 md:p-8 shadow-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 p-1 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
        {done ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-12 h-12 text-real-red mx-auto" />
            <h3 className="mt-4 text-2xl font-semibold">You&apos;re On The List</h3>
            <p className="mt-2 text-muted-foreground text-sm">We&apos;ll Tell You When {city.name} Opens.</p>
            <button onClick={onClose} className="mt-6 rounded-lg bg-real-red text-white px-6 py-2.5 text-sm font-medium hover:opacity-90 transition active:scale-95">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Waitlist</div>
            <h3 className="mt-2 text-2xl md:text-3xl font-semibold">Join The {city.name} Waitlist</h3>
            <p className="mt-2 text-sm text-muted-foreground">Be First To Know When We Launch In {city.name}.</p>
            <form onSubmit={submit} className="mt-5 space-y-3">
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Full Name" className="w-full rounded-lg bg-soft border border-transparent focus:border-real-red focus:bg-white px-4 py-3 text-sm outline-none transition" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" placeholder="Email" className="w-full rounded-lg bg-soft border border-transparent focus:border-real-red focus:bg-white px-4 py-3 text-sm outline-none transition" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Phone" className="w-full rounded-lg bg-soft border border-transparent focus:border-real-red focus:bg-white px-4 py-3 text-sm outline-none transition" />
              <div>
                <div className="text-xs font-medium mb-2">Already Driving On A Gig App?</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: "active", l: "Yes" },
                    { v: "pending", l: "Pending" },
                    { v: "not_yet", l: "Not Yet" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setDriverStatus(opt.v as any)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        driverStatus === opt.v ? "border-real-red bg-real-red text-white" : "border-border bg-white hover:bg-soft"
                      }`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
              <button disabled={submitting} className="w-full rounded-lg bg-real-red text-white py-3 text-sm font-semibold hover:opacity-90 transition active:scale-95 disabled:opacity-50">
                {submitting ? "Submitting…" : "Notify Me"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
