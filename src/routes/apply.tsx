import { createFileRoute, Link, Navigate, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { FadeUp } from "@/components/site/FadeUp";
import { ApplyProgressSlot, ProgressBar } from "@/components/site/ApplicationWizard";
import { APPLY_PROGRESS_ENABLED } from "@/lib/apply-progress";
import { APPLY_VEHICLE_PREFILL_ENABLED } from "@/lib/apply-vehicle-prefill";
import { savePartialApplication } from "@/lib/applications.functions";
import { readWaitlistClaim } from "@/lib/waitlist.functions";
import {
  WAITLIST_CLAIM_ENABLED,
  applySearchKeys,
  claimTokenFromUrl,
  type WaitlistClaimPrefill,
} from "@/lib/waitlist-claim";
import { WelcomeBack, type LinkStatus } from "@/components/site/WelcomeBack";
import { getAttribution } from "@/lib/attribution";
import { supabase } from "@/integrations/supabase/client";
import { resumeTargetFromApply, useResumeToken } from "@/lib/resume-token";
import { SmsConsentField } from "@/components/site/SmsConsentField";
import { PhoneLink } from "@/components/site/PhoneLink";
import { APPLICATION_RESUME_ENABLED } from "@/lib/application-resume-flag";

const CLAIM_STASH = "rr_waitlist_claim";

/**
 * Included in this route's head only while WAITLIST_CLAIM_ENABLED is true.
 * It stashes a real `claim` key and removes it from the address. It does not
 * read or write the Google tag. The tag hotfix already strips `claim` from
 * the address sent to Google, and a route script cannot run before that config.
 * `reclaim=` is left alone.
 */
const STRIP_CLAIM_SCRIPT = `(function () {
  if (location.pathname !== "/apply") return;
  var queryRe = /(?:^|[?&])claim=([^&#]*)/;
  var hashRe = /(?:^|[#&])claim=([^&#]*)/;
  var search = location.search || "";
  var hash = location.hash || "";
  var query = queryRe.exec(search);
  var frag = hashRe.exec(hash);
  var raw = (frag && frag[1]) || (query && query[1]) || "";
  if (!raw) return;
  var token = raw;
  try { token = decodeURIComponent(raw); } catch (e) {}
  try { sessionStorage.setItem(${JSON.stringify(CLAIM_STASH)}, token); } catch (e) {}
  var params = new URLSearchParams(search);
  params.delete("claim");
  var nextSearch = params.toString();
  var hashBody = hash.charAt(0) === "#" ? hash.slice(1) : hash;
  var kept = hashBody ? hashBody.split("&").filter(function (part) {
    return part !== "claim" && part.indexOf("claim=") !== 0;
  }) : [];
  var nextHash = kept.length ? "#" + kept.join("&") : "";
  history.replaceState(history.state, "", location.pathname + (nextSearch ? "?" + nextSearch : "") + nextHash);
})();`;

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
  beforeLoad: ({ search }) => {
    // Hand the token to /thank-you before this page strips it from the URL.
    const handoff = resumeTargetFromApply(search);
    if (handoff) throw redirect(handoff);
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
    scripts: WAITLIST_CLAIM_ENABLED ? [{ children: STRIP_CLAIM_SCRIPT }] : [],
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
  const { t, city: preCity, pickup: prePickup, vehicle_type: preType, vehicle: preVehicle } = Route.useSearch();
  // allowStashed: false — /apply starts a new application. A token stashed by
  // the previous person on a shared or kiosk device must not open their form.
  const token = useResumeToken(t, { allowStashed: false });
  const readClaim = useServerFn(readWaitlistClaim);
  const [claimPrefill, setClaimPrefill] = useState<WaitlistClaimPrefill | null>(null);
  const [claimNote, setClaimNote] = useState<string | null>(null);

  useEffect(() => {
    if (!WAITLIST_CLAIM_ENABLED) {
      try {
        sessionStorage.removeItem(CLAIM_STASH);
      } catch {
        /* storage blocked */
      }
      return;
    }
    let claimToken = "";
    try {
      const url = new URL(window.location.href);
      const fromUrl = claimTokenFromUrl(url.search, url.hash) || "";
      claimToken = fromUrl || sessionStorage.getItem(CLAIM_STASH) || "";
      sessionStorage.removeItem(CLAIM_STASH);
      if (fromUrl) {
        url.searchParams.delete("claim");
        const hashBody = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
        const kept = hashBody
          ? hashBody.split("&").filter((part) => part !== "claim" && !part.startsWith("claim="))
          : [];
        url.hash = kept.length ? `#${kept.join("&")}` : "";
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
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
          {APPLICATION_RESUME_ENABLED === true ? (
            <ApplyResumeGate
              preCity={preCity ?? ""}
              prePickup={prePickup ?? ""}
              preVehicleSize={VEHICLE_TYPE_TO_SIZE[(preType ?? "").toLowerCase()] ?? null}
              preVehicle={preVehicle}
              claimPrefill={WAITLIST_CLAIM_ENABLED ? claimPrefill : null}
              claimNote={WAITLIST_CLAIM_ENABLED ? claimNote : null}
            />
          ) : (
            <ContactStep
              preCity={preCity ?? ""}
              prePickup={prePickup ?? ""}
              preVehicleSize={VEHICLE_TYPE_TO_SIZE[(preType ?? "").toLowerCase()] ?? null}
              preVehicle={preVehicle}
              claimPrefill={WAITLIST_CLAIM_ENABLED ? claimPrefill : null}
              claimNote={WAITLIST_CLAIM_ENABLED ? claimNote : null}
            />
          )}
        </main>
      )}
    </div>
  );
}

/** Panel loads only when APPLY_VEHICLE_PREFILL_ENABLED is exactly true. */
function ApplyVehiclePrefillSlot({ vehicleId }: { vehicleId?: string }) {
  const [Panel, setPanel] = useState<ComponentType<{ vehicleId?: string; source: "search" }> | null>(null);
  useEffect(() => {
    if (APPLY_VEHICLE_PREFILL_ENABLED !== true) return;
    if (!vehicleId) return;
    let cancelled = false;
    import("@/components/site/ApplyVehiclePrefill").then((mod) => {
      if (!cancelled) setPanel(() => mod.ApplyVehiclePrefill);
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);
  if (APPLY_VEHICLE_PREFILL_ENABLED !== true || !vehicleId || !Panel) return null;
  return <Panel vehicleId={vehicleId} source="search" />;
}

function ApplyResumeGate({
  preCity,
  prePickup,
  preVehicleSize,
  preVehicle,
  claimPrefill,
  claimNote,
}: {
  preCity: string;
  prePickup: string;
  preVehicleSize: "Sedan" | "SUV" | "XL" | null;
  preVehicle?: string;
  claimPrefill: WaitlistClaimPrefill | null;
  claimNote: string | null;
}) {
  const [draft, setDraft] = useState<unknown>(null);
  useEffect(() => {
    if (APPLICATION_RESUME_ENABLED !== true) return;
    let live = true;
    void import("@/lib/application-resume-client").then(async (mod) => {
      const found = await mod.loadContinueDraft();
      if (!live) return;
      setDraft(found);
    });
    return () => {
      live = false;
    };
  }, []);
  if (APPLICATION_RESUME_ENABLED !== true || !draft) {
    return (
      <ContactStep
        preCity={preCity}
        prePickup={prePickup}
        preVehicleSize={preVehicleSize}
        preVehicle={preVehicle}
        claimPrefill={claimPrefill}
        claimNote={claimNote}
      />
    );
  }
  return <SavedApplicationSlot draft={draft} />;
}

function SavedApplicationSlot({ draft }: { draft: unknown }) {
  const [banner, setBanner] = useState<ReactNode>(null);
  useEffect(() => {
    if (APPLICATION_RESUME_ENABLED !== true) return;
    let live = true;
    void import("@/components/site/SignedInContinueBanner").then((ui) => {
      if (!live) return;
      setBanner(<ui.SignedInContinueBanner draft={draft as never} />);
    });
    return () => {
      live = false;
    };
  }, [draft]);
  return banner;
}

function ContactStep({
  preCity,
  prePickup,
  preVehicleSize,
  preVehicle,
  claimPrefill,
  claimNote,
}: {
  preCity: string;
  prePickup: string;
  /** Carried from a catalog card. The applicant can still change it in Part 1. */
  preVehicleSize: "Sedan" | "SUV" | "XL" | null;
  /** A vehicles.id from the search key. Shown only while the prefill flag is on. */
  preVehicle?: string;
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

  const contact = (
    <>
        <ProgressBar current="your_info" source="homepage" />
        {WAITLIST_CLAIM_ENABLED && claimNote ? (
          <p role="alert" className="mb-4 text-sm text-real-red">
            {claimNote}
          </p>
        ) : null}
        {APPLY_PROGRESS_ENABLED ? null : (
          <div className="mt-8 text-xs tracking-[0.18em] font-semibold text-real-red uppercase mb-3">Step 1 Of 3</div>
        )}
        <h1 className="text-3xl md:text-4xl font-semibold">Tell Us How To Reach You</h1>
        <p className="mt-3 text-muted-foreground">Two short questions after this, then you're done. No documents needed.</p>
        <ApplyVehiclePrefillSlot vehicleId={preVehicle} />

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

          <div
            className="mt-8 sticky bottom-0 z-10 -mx-6 border-t border-border bg-white/95 px-6 pt-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:backdrop-blur-none"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="w-full inline-flex min-h-11 items-center justify-center rounded-lg bg-real-red text-white px-6 text-sm font-semibold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Continue"}
            </button>
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            By submitting, you agree to our{" "}
            <Link to="/terms" className="inline-flex min-h-11 items-center underline hover:text-foreground">Terms</Link> and{" "}
            <Link to="/privacy" className="inline-flex min-h-11 items-center underline hover:text-foreground">Privacy Policy</Link>.
          </p>
        </div>
        )}
        <div className="mt-5 text-center text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Need Help Applying?</span>{" "}
          Questions about availability, pricing, deposits or your application? Call{" "}
          <PhoneLink placement="application_help" className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline" />.
        </div>
    </>
  );

  if (APPLY_PROGRESS_ENABLED) {
    return (
      <div className="max-w-xl mx-auto">
        <ApplyProgressSlot stepKey="your_info" showNeeded />
        {contact}
      </div>
    );
  }

  return (
    <FadeUp>
      <div className="max-w-xl mx-auto">{contact}</div>
    </FadeUp>
  );
}

function In({ label, type = "text", v, e, on }: { label: string; type?: string; v: string; e?: string; on: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(ev) => on(ev.target.value)}
        className={`mt-1.5 w-full min-h-11 scroll-mb-28 bg-white border ${e ? "border-real-red" : "border-border"} rounded-lg px-3 text-base`}
      />
      {e && <div className="mt-1 text-xs text-real-red">{e}</div>}
    </label>
  );
}