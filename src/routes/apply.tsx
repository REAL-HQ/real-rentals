import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { FadeUp } from "@/components/site/FadeUp";
import { ProgressBar } from "@/components/site/ApplicationWizard";
import { savePartialApplication } from "@/lib/applications.functions";
import { readWaitlistClaim } from "@/lib/waitlist.functions";
import { WAITLIST_CLAIM_ENABLED, applySearchKeys, landingPageWithoutClaim, type WaitlistClaimPrefill } from "@/lib/waitlist-claim";

const CLAIM_STASH = "rr_waitlist_claim";

/** Runs in this route's head, before gtag.js handles the queued config. */
const STRIP_CLAIM_SCRIPT = `(function () {
  if (location.pathname !== "/apply") return;
  var token = "";
  var hash = location.hash || "";
  if (hash.indexOf("#claim=") === 0) {
    try { token = decodeURIComponent(hash.slice(7)); } catch (e) { token = hash.slice(7); }
  }
  var params = new URLSearchParams(location.search);
  if (!token && params.has("claim")) token = params.get("claim") || "";
  if (params.has("claim")) params.delete("claim");
  var search = params.toString();
  var cleanPath = location.pathname + (search ? "?" + search : "");
  if (token) {
    try { sessionStorage.setItem(${JSON.stringify(CLAIM_STASH)}, token); } catch (e) {}
  }
  if (token || hash.indexOf("#claim=") === 0 || location.search.indexOf("claim=") !== -1) {
    history.replaceState(history.state, "", cleanPath);
    var page = location.origin + cleanPath;
    var queue = window.dataLayer;
    if (queue) {
      for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        if (item && item[0] === "config") item[2] = Object.assign({}, item[2] || {}, { page_location: page });
      }
    }
    if (typeof gtag === "function") gtag("set", { page_location: page });
  }
})();`;
import { WelcomeBack, type LinkStatus } from "@/components/site/WelcomeBack";
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
    for (const key of applySearchKeys(WAITLIST_CLAIM_ENABLED)) {
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
    scripts: [{ children: STRIP_CLAIM_SCRIPT }],
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
  const search = Route.useSearch();
  const { t, city: preCity, pickup: prePickup, vehicle_type: preType } = search;
  // allowStashed: false — /apply starts a new application. A token stashed by
  // the previous person on a shared or kiosk device must not open their form.
  const token = useResumeToken(t, { allowStashed: false });
  const readClaim = useServerFn(readWaitlistClaim);
  const [claimPrefill, setClaimPrefill] = useState<WaitlistClaimPrefill | null>(null);
  const [claimNote, setClaimNote] = useState<string | null>(null);

  useEffect(() => {
    if (!WAITLIST_CLAIM_ENABLED) return;
    let claimToken = "";
    try {
      const url = new URL(window.location.href);
      const fromHash = url.hash.startsWith("#claim=") ? decodeURIComponent(url.hash.slice("#claim=".length)) : "";
      const fromQuery = url.searchParams.get("claim") || "";
      claimToken = fromHash || fromQuery;
      if (!claimToken) claimToken = sessionStorage.getItem(CLAIM_STASH) || "";
      sessionStorage.removeItem(CLAIM_STASH);
      if (fromHash || fromQuery) {
        const next = landingPageWithoutClaim(url.pathname + url.search + url.hash) || url.pathname;
        window.history.replaceState(window.history.state, "", next);
        const page = url.origin + next;
        const gtag = (window as { gtag?: (command: string, fields: { page_location: string }) => void }).gtag;
        if (typeof gtag === "function") gtag("set", { page_location: page });
      }
    } catch {
      claimToken = "";
    }
    if (!claimToken) return;
    let live = true;
    readClaim({ data: { token: claimToken } })
      .then((res) => {
        if (!live) return;
        if (res.ok) {
          setClaimPrefill(res.prefill);
          setClaimNote(null);
        } else {
          setClaimNote("error" in res && res.error ? res.error : "This link is not valid.");
        }
      })
      .catch(() => {
        if (live) setClaimNote("This link is not valid.");
      });
    return () => {
      live = false;
    };
  }, [readClaim]);

  return (
    // No site header here. The wizard's dark panel already carries the
    // REAL RENTALS mark, and stacking the nav on top of it put two logos on
    // screen at once. A signup flow also converts better without the rest of
    // the site one click away.
    <div className="min-h-screen bg-background">
      {token === undefined ? null : token ? (
        <Navigate to="/thank-you" search={{ t: token }} replace />
      ) : (
        <main className="mx-auto px-6 pt-12 md:pt-20 pb-24 w-full max-w-[1600px]">
          <ContactStep
            preCity={preCity ?? ""}
            prePickup={prePickup ?? ""}
            preVehicleSize={VEHICLE_TYPE_TO_SIZE[(preType ?? "").toLowerCase()] ?? null}
            claimPrefill={WAITLIST_CLAIM_ENABLED ? claimPrefill : null}
            claimNote={WAITLIST_CLAIM_ENABLED ? claimNote : null}
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
  claimPrefill,
  claimNote,
}: {
  preCity: string;
  prePickup: string;
  /** Carried from a catalog card. The applicant can still change it in Part 1. */
  preVehicleSize: "Sedan" | "SUV" | "XL" | null;
  claimPrefill: WaitlistClaimPrefill | null;
  claimNote: string | null;
}) {
  const navigate = useNavigate();
  const savePartial = useServerFn(savePartialApplication);
  const [returning, setReturning] = useState<{ email: string; status: LinkStatus; retryAfterSeconds: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hp, setHp] = useState("");
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", sms_consent: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [market, setMarket] = useState<{ id: string; name: string; state: string | null } | null>(null);

  useEffect(() => {
    if (!preCity) return;
    if (WAITLIST_CLAIM_ENABLED && claimPrefill?.market_id) return;
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
  }, [preCity, claimPrefill]);

  useEffect(() => {
    if (!WAITLIST_CLAIM_ENABLED || !claimPrefill) return;
    setForm((prev) => ({
      ...prev,
      full_name: claimPrefill.full_name,
      email: claimPrefill.email,
      phone: claimPrefill.phone ?? "",
    }));
    if (claimPrefill.market_id) {
      setMarket({
        id: claimPrefill.market_id,
        name: claimPrefill.city ?? preCity,
        state: claimPrefill.state,
      });
    }
  }, [claimPrefill, preCity]);

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
          pickup_date: (WAITLIST_CLAIM_ENABLED && claimPrefill?.pickup_date) || prePickup || null,
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
        setReturning({ email: form.email, status: data.linkStatus ?? "sent", retryAfterSeconds: data.retryAfterSeconds ?? 120 });
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
        {claimNote && <p role="alert" className="mb-4 text-sm text-real-red">{claimNote}</p>}
        <div className="mt-8 text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase mb-3">Step 1 Of 3</div>
        <h1 className="text-3xl md:text-4xl font-semibold">Tell Us How To Reach You</h1>
        <p className="mt-3 text-muted-foreground">Two short questions after this, then you're done. No documents needed.</p>

        {returning !== null ? (
          <div className="mt-8">
            <WelcomeBack email={returning.email} initial={returning} onBack={() => setReturning(null)} />
          </div>
        ) : (
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
        )}
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