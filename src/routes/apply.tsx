import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { FadeUp } from "@/components/site/FadeUp";
import { ApplicationWizard, ProgressBar } from "@/components/site/ApplicationWizard";
import { savePartialApplication } from "@/lib/applications.functions";
import { getAttribution } from "@/lib/attribution";
import { supabase } from "@/integrations/supabase/client";
import { useResumeToken } from "@/lib/resume-token";
import { SmsConsentField } from "@/components/site/SmsConsentField";
import { PhoneLink } from "@/components/site/PhoneLink";

export const Route = createFileRoute("/apply")({
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    /** Resume token. Never an application id — see resume-tokens.server.ts. */
    t?: string;
    city?: string;
    pickup?: string;
    /** A real vehicles.id, from an inventory card. */
    vehicle?: string;
    /**
     * A marketing catalog category ("sedan" | "suv" | "xl"), from a catalog
     * card. Deliberately a separate key from `vehicle`: a representative type
     * is not a vehicle id and must never be mistaken for one downstream.
     * Carried so the landing URL records which category converted.
     */
    vehicle_type?: string;
  } => {
    // Only keep params that actually have a value so the URL never ends up
    // as /apply?t=&city=&pickup=&vehicle=
    const pick = (v: unknown) => {
      const str = typeof v === "string" ? v.trim() : "";
      return str ? str : undefined;
    };
    const out: Record<string, string> = {};
    for (const key of ["t", "city", "pickup", "vehicle", "vehicle_type"] as const) {
      const value = pick(s[key]);
      if (value) out[key] = value;
    }
    return out;
  },
  head: () => ({
    meta: [
      { title: "Apply — REAL RENTALS" },
      { name: "description", content: "Complete your driver application — quick, no payment required." },
      { property: "og:title", content: "Apply — REAL RENTALS" },
      { property: "og:description", content: "Complete your driver application — quick, no payment required." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://drivereal.com/apply" }],
  }),
  component: ApplyPage,
});

/**
 * A marketing catalog category as the application asks the question.
 * Anything else — including a leftover `vehicle` UUID — maps to null, so no
 * unrecognised value reaches the application.
 */
const VEHICLE_TYPE_TO_SIZE: Record<string, "Sedan" | "SUV" | "XL"> = {
  sedan: "Sedan",
  suv: "SUV",
  xl: "XL",
};

function ApplyPage() {
  const { t, city: preCity, pickup: prePickup, vehicle_type: preType } = Route.useSearch();
  // allowStashed: false — /apply starts a new application. A token stashed by
  // the previous person on a shared or kiosk device must not open their form.
  const token = useResumeToken(t, { allowStashed: false });

  return (
    // No site header here. The wizard's dark panel already carries the
    // REAL RENTALS mark, and stacking the nav on top of it put two logos on
    // screen at once. A signup flow also converts better without the rest of
    // the site one click away.
    <div className="min-h-screen bg-background">
      {token === undefined ? null : token ? (
        <ApplicationWizard token={token} />
      ) : (
        <main className="mx-auto px-6 pt-12 md:pt-20 pb-24 w-full max-w-[1600px]">
          <ContactStep
            preCity={preCity ?? ""}
            prePickup={prePickup ?? ""}
            preVehicleSize={VEHICLE_TYPE_TO_SIZE[(preType ?? "").toLowerCase()] ?? null}
          />
        </main>
      )}
    </div>
  );
}

function ContactStep({
  preCity,
  prePickup,
  preVehicleSize,
}: {
  preCity: string;
  prePickup: string;
  /** Carried from a catalog card. The applicant can still change it in Part 1. */
  preVehicleSize: "Sedan" | "SUV" | "XL" | null;
}) {
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

  // Attribution captured in __root; read here at submit time.

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!z.string().min(2).safeParse(form.full_name).success) e.full_name = "Required";
    if (!z.string().email().safeParse(form.email).success) e.email = "Invalid email";
    if (!/^\d{7,}$/.test(form.phone.replace(/\D/g, ""))) e.phone = "Invalid phone";
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
          consent_page: "/apply",
          market_id: market?.id ?? null,
          city: market?.name ?? preCity ?? null,
          state: market?.state ?? null,
          pickup_date: prePickup || null,
          vehicle_size: preVehicleSize,
          source: "homepage",
          ...getAttribution(),
        },
      });
      // The token, not the id. It is minted server-side on this call and this
      // is the only time it exists in plaintext.
      if (!data.token) {
        // We matched an application that already exists. The link goes to the
        // address on that record, not to whoever filled this form in.
        toast.success(
          "You already have an application with us — we've emailed you the link to finish it.",
        );
        return;
      }
      navigate({ to: "/thank-you", search: { t: data.token } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FadeUp>
      <div className="max-w-xl mx-auto">
        <ProgressBar current="your_info" source="homepage" />
        <div className="mt-8 text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase mb-3">Step 1 Of 3</div>
        <h1 className="text-3xl md:text-4xl font-semibold">Tell Us How To Reach You</h1>
        <p className="mt-3 text-muted-foreground">Two short questions after this, then you're done. No documents needed.</p>

        <div className="mt-8 rounded-2xl bg-soft p-6 md:p-8">
          <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="hidden" aria-hidden />
          <div className="grid grid-cols-1 gap-5">
            <In label="Full Name" v={form.full_name} e={errors.full_name} on={(v) => update("full_name", v)} />
            <In label="Email" type="email" v={form.email} e={errors.email} on={(v) => update("email", v)} />
            <In label="Mobile Phone" v={form.phone} e={errors.phone} on={(v) => update("phone", v)} />
          </div>

          <SmsConsentField className="mt-5" checked={form.sms_consent} onChange={(v) => update("sms_consent", v)} />

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
        <div className="mt-5 text-center text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Need Help Applying?</span>{" "}
          Questions about availability, pricing, deposits or your application? Call{" "}
          <PhoneLink placement="application_help" className="font-medium text-foreground underline-offset-4 hover:underline" />.
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