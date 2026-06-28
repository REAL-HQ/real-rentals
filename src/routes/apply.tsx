import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { FadeUp } from "@/components/site/FadeUp";
import { submitApplication } from "@/lib/applications.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/apply")({
  validateSearch: (s: Record<string, unknown>) => ({
    vehicle: (s.vehicle as string) || "",
    city: (s.city as string) || "",
    len: (s.len as string) || "",
    gig: (s.gig as string) || "",
  }),
  head: () => ({
    meta: [
      { title: "Step 1 of 2 — REAL RENTALS" },
      { name: "description", content: "Get a rideshare vehicle quote in seconds. Step 1 of 2." },
      { property: "og:title", content: "Step 1 of 2 — REAL RENTALS" },
      { property: "og:description", content: "Get a rideshare vehicle quote in seconds. Step 1 of 2." },
    ],
  }),
  component: ApplyStep1,
});

const STORAGE_KEY = "real-apply-step1-v1";

const PLATFORM_STATUSES = [
  { value: "Yes", label: "Yes" },
  { value: "Pending", label: "Pending" },
  { value: "Not Yet", label: "Not Yet" },
];

const VALID_GIG = (v: string): v is "Yes" | "Pending" | "Not Yet" =>
  ["Yes", "Pending", "Not Yet"].includes(v);

function parseLen(value: string) {
  if (value === "By The Week") return { rental_term: "weekly" as const, rental_length: "1 Week" };
  if (value === "By The Month") return { rental_term: "monthly" as const, rental_length: "1 Month" };
  return { rental_term: "weekly" as const, rental_length: "1 Week" };
}

type Step1Form = {
  full_name: string;
  phone: string;
  email: string;
  platform_status: "Yes" | "Pending" | "Not Yet" | "";
  vehicle_id: string;
  sms_consent: boolean;
  terms_accepted: boolean;
};

function getInitial(vehicle_id: string, gig: string): Step1Form {
  return {
    full_name: "",
    phone: "",
    email: "",
    platform_status: VALID_GIG(gig) ? gig : "",
    vehicle_id,
    sms_consent: false,
    terms_accepted: false,
  };
}

function ApplyStep1() {
  const { vehicle: preVehicle, city: preCity, len: preLen, gig: preGig } = Route.useSearch();
  const navigate = useNavigate();
  const saveApplication = useServerFn(submitApplication);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState<Step1Form>(() => {
    if (typeof window === "undefined") return getInitial(preVehicle, preGig);
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...getInitial(preVehicle, preGig), ...JSON.parse(raw) } : getInitial(preVehicle, preGig);
  });
  const [market, setMarket] = useState<{ id: string; name: string; state: string | null } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  }, [f]);

  useEffect(() => {
    if (!preCity) return;
    supabase
      .from("sites")
      .select("market_id, markets(name, state)")
      .eq("slug", preCity)
      .eq("is_published", true)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const m = data.markets as { name: string; state: string | null } | null;
        setMarket({ id: data.market_id, name: m?.name ?? preCity, state: m?.state ?? null });
      });
  }, [preCity]);

  const gigLocked = useMemo(() => VALID_GIG(preGig), [preGig]);
  const lenInfo = useMemo(() => parseLen(preLen), [preLen]);

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

  const update = <K extends keyof Step1Form>(k: K, v: Step1Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!z.string().min(2).safeParse(f.full_name).success) errs.full_name = "Required";
    if (!z.string().email().safeParse(f.email).success) errs.email = "Invalid email";
    if (!/^\d{7,}$/.test(f.phone.replace(/\D/g, ""))) errs.phone = "Invalid phone";
    if (!f.platform_status) errs.platform_status = "Required";
    if (!f.sms_consent) errs.sms_consent = "Required";
    if (!f.terms_accepted) errs.terms_accepted = "Required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  async function submit() {
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setSubmitting(true);
    const payload = {
      full_name: f.full_name,
      phone: f.phone,
      email: f.email,
      platform_status: f.platform_status,
      vehicle_id: f.vehicle_id || null,
      market_id: market?.id || null,
      city: market?.name || preCity || null,
      state: market?.state || null,
      rental_length: preLen ? lenInfo.rental_length : null,
      rental_term: preLen ? lenInfo.rental_term : null,
      sms_consent: f.sms_consent,
      source: "homepage",
      ...utms,
    };
    try {
      const data = await saveApplication({ data: payload });
      localStorage.removeItem(STORAGE_KEY);
      navigate({ to: "/apply/step2", search: { id: data.id } });
    } catch (error: any) {
      toast.error(error?.message || "Could not submit your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1">
        <section id="quote-form" className="pt-12 md:pt-20 pb-24 mx-auto px-6 w-full max-w-[1600px]">
          <FadeUp>
            <div className="max-w-xl mx-auto">
              <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase mb-3">Step 1 Of 2</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Get Your Quote</h1>
              <p className="mt-3 text-muted-foreground">Tell us a little about yourself to get started.</p>
            </div>
          </FadeUp>

          <FadeUp delay={80}>
            <div className="mt-10 max-w-xl mx-auto rounded-2xl bg-soft p-6 md:p-8">
              <div className="grid grid-cols-1 gap-5">
                <In label="Full name" v={f.full_name} e={errors.full_name} on={(v) => update("full_name", v)} />
                <In label="Email" type="email" v={f.email} e={errors.email} on={(v) => update("email", v)} />
                <In label="Phone" v={f.phone} e={errors.phone} on={(v) => update("phone", v)} />

                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Are You Already Active On A Gig App?</label>
                  {gigLocked ? (
                    <div className="mt-2 flex items-center gap-3">
                      <span className="inline-flex items-center gap-2 rounded-lg border border-real-red bg-real-red/10 px-4 py-2 text-sm font-medium text-real-red">
                        {f.platform_status} <span className="text-[10px] uppercase tracking-wider opacity-70">(from quote)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => update("platform_status", "")}
                        className="text-sm text-real-red underline hover:opacity-80"
                      >
                        Edit
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {PLATFORM_STATUSES.map((s) => {
                        const active = f.platform_status === s.value;
                        return (
                          <button
                            key={s.value}
                            type="button"
                            onClick={() => update("platform_status", s.value as Step1Form["platform_status"])}
                            className={`px-5 py-2 rounded-lg text-sm border transition ${
                              active
                                ? "bg-real-red text-white border-real-red"
                                : "bg-white text-foreground border-border hover:border-foreground/40"
                            }`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {errors.platform_status && <div className="mt-2 text-sm text-real-red">{errors.platform_status}</div>}
                </div>
              </div>

              <label className="mt-5 flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.sms_consent}
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
                  checked={f.terms_accepted}
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
                className="mt-8 w-full inline-flex items-center justify-center rounded-lg bg-real-red text-white px-6 py-3 text-sm font-semibold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Continue"}
              </button>
            </div>
          </FadeUp>
        </section>
      </main>
    </div>
  );
}

function In({
  label,
  type = "text",
  v,
  e,
  on,
}: {
  label: string;
  type?: string;
  v: string;
  e?: string;
  on: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => on(e.target.value)}
        className={`mt-1 w-full bg-white border ${e ? "border-real-red" : "border-border"} rounded-lg px-3 py-2 text-sm`}
      />
      {e && <div className="mt-1 text-xs text-real-red">{e}</div>}
    </label>
  );
}
