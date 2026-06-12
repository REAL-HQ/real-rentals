import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { FadeUp } from "@/components/site/FadeUp";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { z } from "zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Check, Users, DoorOpen, Fuel, Car, Pencil, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

export const Route = createFileRoute("/apply")({
  validateSearch: (s: Record<string, unknown>) => ({ vehicle: (s.vehicle as string) || "" }),
  head: () => ({
    meta: [
      { title: "Apply To Drive — REAL AUTOMOTIVE" },
      { name: "description", content: "Apply in minutes. Most drivers are approved in 24 hours." },
      { property: "og:title", content: "Apply To Drive — REAL AUTOMOTIVE" },
      { property: "og:description", content: "Five minutes. No dealership games." },
    ],
  }),
  component: Apply,
});

type Form = {
  full_name: string; email: string; phone: string; dob: string;
  address: string; city: string; state: string; zip: string;
  license_number: string; license_state: string; license_expiration: string; years_licensed: number;
  license_photo_url: string;
  platforms: string[]; weekly_hours: number; platform_active: boolean;
  vehicle_id: string; start_date: string; rental_term: string; payment_method: string;
  consent_gps: boolean; consent_background: boolean; consent_prepay: boolean; consent_terms: boolean;
};

const STEPS = ["Personal", "License", "Platforms", "Vehicle", "Consents", "Review"];
const PLATFORMS = ["Uber", "Lyft", "DoorDash", "Instacart", "Amazon Flex", "Uber Eats"];
const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District Of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

function Apply() {
  const { vehicle: preVehicle } = Route.useSearch();
  const STORAGE_KEY = "real-apply-draft-v1";
  const loadDraft = (): { step: number; f: Form } | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };
  const draft = loadDraft();
  const [step, setStep] = useState(draft?.step ?? 0);
  const [vehicles, setVehicles] = useState<Tables<"vehicles">[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [termsOpen, setTermsOpen] = useState(false);
  const [f, setF] = useState<Form>(draft?.f ?? {
    full_name: "", email: "", phone: "", dob: "",
    address: "", city: "", state: "", zip: "",
    license_number: "", license_state: "", license_expiration: "", years_licensed: 1,
    license_photo_url: "",
    platforms: [], weekly_hours: 30, platform_active: true,
    vehicle_id: preVehicle, start_date: "", rental_term: "weekly", payment_method: "debit",
    consent_gps: true, consent_background: false, consent_prepay: false, consent_terms: false,
  });
  const update = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    supabase.from("vehicles").select("*").eq("status", "available").order("make").then(({ data }) => setVehicles(data || []));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || submitted) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, f })); } catch {}
  }, [step, f, submitted]);

  const validateStep = (): boolean => {
    const errs: Record<string, string> = {};
    if (step === 0) {
      if (!z.string().min(2).safeParse(f.full_name).success) errs.full_name = "Required";
      if (!z.string().email().safeParse(f.email).success) errs.email = "Invalid email";
      if (!/^[\d\s\-\(\)\+]{7,}$/.test(f.phone)) errs.phone = "Invalid phone";
      if (!f.dob) errs.dob = "Required";
      else {
        const age = (Date.now() - new Date(f.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
        if (age < 21) errs.dob = "Must be 21+";
      }
    } else if (step === 1) {
      if (!f.license_number) errs.license_number = "Required";
      if (!f.license_state) errs.license_state = "Required";
      if (!f.license_expiration) errs.license_expiration = "Required";
      else if (new Date(f.license_expiration) < new Date()) errs.license_expiration = "License expired";
    } else if (step === 2) {
      if (f.platforms.length === 0) errs.platforms = "Select at least one";
    } else if (step === 3) {
      if (!f.vehicle_id) errs.vehicle_id = "Pick a vehicle";
      if (!f.start_date) errs.start_date = "Required";
    } else if (step === 4) {
      if (!f.consent_background || !f.consent_prepay || !f.consent_terms)
        errs.consents = "All consents are required";
    }
    setStepErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (validateStep()) {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      toast.error("Please fix the highlighted fields before continuing.");
      if (typeof document !== "undefined") {
        const firstErr = document.querySelector(".field-error");
        if (firstErr) firstErr.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };
  const back = () => {
    if (step === 0) {
      window.history.back();
      return;
    }
    setStep((s) => Math.max(s - 1, 0));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function submit() {
    if (!validateStep()) return;
    setError(null);
    const payload = { ...f, vehicle_id: f.vehicle_id || null, dob: f.dob || null, license_expiration: f.license_expiration || null, start_date: f.start_date || null };
    const { error } = await supabase.from("applications").insert(payload as any);
    if (error) setError(error.message);
    else {
      setSubmitted(true);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
  }

  const selectedVehicle = vehicles.find((v) => v.id === f.vehicle_id);
  const weeklyToMonthlySavings = selectedVehicle
    ? Math.round((Number(selectedVehicle.weekly_rate) * 4) - (selectedVehicle.monthly_rate ?? Number(selectedVehicle.weekly_rate) * 4))
    : 0;

const paymentLabel = ({ debit: "Debit", credit: "Credit", cashapp: "Cash App", cash: "Cash", zelle: "Zelle", venmo: "Venmo", paypal: "PayPal", applepay: "Apple Pay", googlepay: "Google Pay", ach: "Bank Transfer (ACH)" } as Record<string, string>)[f.payment_method] || "—";
  const tierOptions = (() => {
    if (!selectedVehicle) return [] as { key: string; label: string; price: number; unit: string; baseline: number; discountPct: number }[];
    const weekly = Number(selectedVehicle.weekly_rate);
    const monthlyBaseline = weekly * 4;
    const annualBaseline = monthlyBaseline * 12;
    const monthly = Math.max(0, monthlyBaseline - 100);
    const annual = Math.max(0, monthlyBaseline * 10);
    return [
      { key: "weekly", label: "Weekly", price: weekly, unit: "/week", baseline: weekly, discountPct: 0 },
      { key: "monthly", label: "Monthly", price: monthly, unit: "/month", baseline: monthlyBaseline, discountPct: monthlyBaseline > 0 ? Math.max(0, Math.round((1 - monthly / monthlyBaseline) * 100)) : 0 },
      { key: "annual", label: "Annual", price: annual, unit: "/year", baseline: annualBaseline, discountPct: annualBaseline > 0 ? Math.max(0, Math.round((1 - annual / annualBaseline) * 100)) : 0 },
    ];
  })();
  const activeTier = tierOptions.find((t) => t.key === f.rental_term) ?? tierOptions[0];
  const dueAtPickup = selectedVehicle && activeTier ? activeTier.price + Number(selectedVehicle.deposit ?? 0) : 0;

  const pricingSummary = selectedVehicle ? (
    <div className="rounded-2xl border border-border bg-soft p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pricing Summary</div>
        <button
          type="button"
          onClick={() => setStep(3)}
          className="text-[11px] font-medium text-real-red hover:opacity-80 underline underline-offset-2"
        >
          Change Vehicle
        </button>
      </div>

      <div className="mb-4 rounded-xl overflow-hidden bg-white border border-border">
        {selectedVehicle.photos?.[0] ? (
          <div className="aspect-[16/9] bg-soft">
            <img
              src={selectedVehicle.photos[0]}
              alt={`${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`}
              className="w-full h-full object-cover"
            />
          </div>
        ) : null}
        <div className="p-3">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-semibold leading-tight truncate">
              {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
              {selectedVehicle.trim ? ` ${selectedVehicle.trim}` : ""}
            </div>
            <div className="text-[11px] font-semibold text-real-red whitespace-nowrap">
              ${Number(selectedVehicle.weekly_rate)}<span className="font-medium">/wk</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {selectedVehicle.body_type && (
              <span className="inline-flex items-center gap-1"><Car size={12} />{selectedVehicle.body_type}</span>
            )}
            {selectedVehicle.seats && (
              <span className="inline-flex items-center gap-1"><Users size={12} />{selectedVehicle.seats}</span>
            )}
            {selectedVehicle.doors && (
              <span className="inline-flex items-center gap-1"><DoorOpen size={12} />{selectedVehicle.doors}</span>
            )}
            {selectedVehicle.mpg && (
              <span className="inline-flex items-center gap-1"><Fuel size={12} />{selectedVehicle.mpg}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {tierOptions.map((t) => {
          const active = t.key === f.rental_term;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => update("rental_term", t.key as any)}
              className={`text-left rounded-xl p-3 transition ${active ? "bg-white border-2 border-real-red" : "border border-border bg-white hover:border-foreground/30"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.label}</span>
                {t.discountPct > 0 && (
                  <span className="text-[9px] font-semibold text-real-red bg-real-red/10 rounded-full px-1.5 py-0.5">−{t.discountPct}%</span>
                )}
              </div>
              <div className="mt-1 text-sm font-semibold">${t.price}<span className="text-[10px] font-normal text-muted-foreground">{t.unit}</span></div>
              {t.discountPct > 0 && (
                <div className="text-[10px] text-muted-foreground line-through">${t.baseline}{t.unit}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-y-2 text-sm">
        <div className="text-muted-foreground">Vehicle</div>
        <div className="text-right font-medium">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</div>
        <div className="text-muted-foreground">{activeTier?.label} Rental</div>
        <div className="text-right font-medium">${activeTier?.price}{activeTier?.unit}</div>
        {activeTier && activeTier.discountPct > 0 && (
          <>
            <div className="text-muted-foreground">{activeTier.label} Discount</div>
            <div className="text-right font-medium text-real-red">−{activeTier.discountPct}% (saves ${activeTier.baseline - activeTier.price})</div>
          </>
        )}
        <div className="text-muted-foreground">Refundable Security Deposit</div>
        <div className="text-right font-medium">${Number(selectedVehicle.deposit ?? 0)}</div>
        <div className="text-muted-foreground">Payment Method</div>
        <div className="text-right font-medium">{paymentLabel}</div>
        <div className="col-span-2 border-t border-border my-1" />
        <div className="font-semibold">Due At Pickup</div>
        <div className="text-right font-semibold text-real-red">${dueAtPickup}</div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Your security deposit is fully refundable upon vehicle return, less any
        outstanding tolls, tickets, damages, unpaid balances, cleaning fees, or
        other charges outlined in the rental agreement.
      </p>
    </div>
  ) : null;

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Nav />
        <main className="flex-1 container-real py-32 text-center">
          <FadeUp>
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Done</div>
            <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Application Received.</h1>
            <p className="mt-6 text-lg text-muted-foreground mx-auto whitespace-nowrap">
              We Review Most Applications Within 24 Hours. Check Your Email — We'll Be In Touch.
            </p>
            <Link to="/fleet" className="mt-10 inline-flex rounded-lg bg-black px-7 py-3 text-sm font-medium text-white hover:bg-real-red transition">
              Back To Fleet
            </Link>
          </FadeUp>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1">
      <section className="pt-12 md:pt-20 pb-24 mx-auto px-6 w-full max-w-[1600px]">
        {/* Uniform progress bar — always full width */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
            <div>Step {step + 1} of {STEPS.length} — {STEPS[step]}</div>
            <div>{Math.round(((step + 1) / STEPS.length) * 100)}%</div>
          </div>
          <div className="h-1 bg-soft rounded-full overflow-hidden">
            <div className="h-full bg-real-red transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        {/* Two-panel layout for all steps */}
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-8">
          <div className="min-w-0">
          {step === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <In label="Full name" v={f.full_name} e={stepErrors.full_name} on={(v) => update("full_name", v)} />
              <In label="Email" type="email" v={f.email} e={stepErrors.email} on={(v) => update("email", v)} />
              <In label="Phone" v={f.phone} e={stepErrors.phone} on={(v) => update("phone", v)} />
              <In label="Date of birth" type="date" v={f.dob} e={stepErrors.dob} on={(v) => update("dob", v)} />
              <In label="Address" v={f.address} on={(v) => update("address", v)} className="md:col-span-2" />
              <In label="City" v={f.city} on={(v) => update("city", v)} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">State</label>
                  <SoftSelect value={f.state} onChange={(v) => update("state", v)} options={US_STATES.map((s) => ({ value: s.code, label: s.name }))} />
                </div>
                <In label="ZIP" v={f.zip} on={(v) => update("zip", v)} />
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <In label="License number" v={f.license_number} e={stepErrors.license_number} on={(v) => update("license_number", v)} />
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">License State</label>
                <SoftSelect value={f.license_state} onChange={(v) => update("license_state", v)} options={US_STATES.map((s) => ({ value: s.code, label: s.name }))} />
                {stepErrors.license_state && <div className="mt-1 text-xs text-real-red">{stepErrors.license_state}</div>}
              </div>
              <In label="Expiration" type="date" v={f.license_expiration} e={stepErrors.license_expiration} on={(v) => update("license_expiration", v)} />
              <In label="Years licensed" type="number" v={String(f.years_licensed)} on={(v) => update("years_licensed", Number(v))} />
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">License Photo (Front)</label>
                <label className="mt-2 flex items-center justify-between gap-4 rounded-lg border-2 border-dashed border-border bg-soft hover:bg-soft/70 hover:border-real-red/40 transition cursor-pointer px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-real-red/10 text-real-red">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </span>
                    <div>
                      <div className="text-sm font-medium">{f.license_photo_url ? "Photo Uploaded" : "Upload License Photo"}</div>
                      <div className="text-xs text-muted-foreground">{f.license_photo_url ? "Tap to replace" : "PNG or JPG, front side only"}</div>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg bg-black text-white px-4 py-2 text-xs font-semibold">Choose File</span>
                  <input
                    type="file" accept="image/*" className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      const path = `${Date.now()}-${file.name}`;
                      const { error } = await supabase.storage.from("license-uploads").upload(path, file);
                      if (!error) update("license_photo_url", path);
                    }}
                  />
                </label>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Platforms you'll drive for</div>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const on = f.platforms.includes(p);
                  return (
                    <button type="button" key={p} onClick={() => update("platforms", on ? f.platforms.filter((x) => x !== p) : [...f.platforms, p])}
                      className={`rounded-lg px-5 py-2 text-sm border transition ${on ? "bg-[#FFD6E0] text-[#7A1F3D] border-[#F5A8BD]" : "border-border hover:border-black"}`}>
                      {p}
                    </button>
                  );
                })}
                {f.platforms.filter((p) => !PLATFORMS.includes(p)).map((p) => (
                  <button type="button" key={p} onClick={() => update("platforms", f.platforms.filter((x) => x !== p))}
                    className="rounded-lg px-5 py-2 text-sm border transition bg-[#FFD6E0] text-[#7A1F3D] border-[#F5A8BD] inline-flex items-center gap-2">
                    {p}<span aria-hidden className="text-[#7A1F3D]/60">×</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  placeholder="Add another platform…"
                  className="flex-1 bg-soft rounded-lg px-5 py-2 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = (e.currentTarget.value || "").trim();
                      if (v && !f.platforms.includes(v)) update("platforms", [...f.platforms, v]);
                      e.currentTarget.value = "";
                    }
                  }}
                />
                <button type="button"
                  onClick={(e) => {
                    const input = (e.currentTarget.previousSibling as HTMLInputElement);
                    const v = (input.value || "").trim();
                    if (v && !f.platforms.includes(v)) update("platforms", [...f.platforms, v]);
                    input.value = "";
                  }}
                  className="rounded-lg bg-black text-white px-4 py-2 text-sm hover:bg-real-red transition">Add</button>
              </div>
              {stepErrors.platforms && <div className="mt-2 text-sm text-real-red">{stepErrors.platforms}</div>}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <In label="Weekly hours" type="number" v={String(f.weekly_hours)} on={(v) => update("weekly_hours", Number(v))} />
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Active account?</label>
                  <SoftSelect value={String(f.platform_active)} onChange={(v) => update("platform_active", v === "true")} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No, I'll sign up" }]} />
                </div>
              </div>
            </div>
          )}
          {step === 3 && (
            <div>
              {/* Inventory */}
              <div className="lg:h-full lg:flex lg:flex-col lg:min-h-0">
                <div className="flex items-baseline justify-between mb-3">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Preferred vehicle</label>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{vehicles.length} Available</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-2 -mr-2 p-1">
                  {vehicles.map((v) => {
                    const active = v.id === f.vehicle_id;
                    const photo = v.photos?.[0];
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => update("vehicle_id", v.id)}
                        className={`relative text-left rounded-xl overflow-hidden bg-white transition outline-none ${active ? "border-2 border-real-red" : "border border-border hover:border-foreground/40"}`}
                      >
                        <div className="aspect-[16/10] bg-soft overflow-hidden relative">
                          {photo ? (
                            <img src={photo} alt={`${v.year} ${v.make} ${v.model}`} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No Photo</div>
                          )}
                          <div className="absolute top-2 right-2 rounded-md bg-white/95 backdrop-blur px-2 py-1 text-[11px] font-semibold shadow-sm text-real-red">
                            ${Number(v.weekly_rate)}<span className="font-medium">/wk</span>
                          </div>
                          {active && (
                            <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-real-red text-white pl-1.5 pr-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow">
                              <Check size={12} strokeWidth={3} />
                              Selected
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <div className="text-sm font-semibold leading-tight truncate">
                            {v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ""}
                          </div>
                          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                            {v.body_type && (
                              <span className="inline-flex items-center gap-1"><Car size={12} />{v.body_type}</span>
                            )}
                            {v.seats && (
                              <span className="inline-flex items-center gap-1"><Users size={12} />{v.seats}</span>
                            )}
                            {v.doors && (
                              <span className="inline-flex items-center gap-1"><DoorOpen size={12} />{v.doors}</span>
                            )}
                            {v.mpg && (
                              <span className="inline-flex items-center gap-1"><Fuel size={12} />{v.mpg}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {stepErrors.vehicle_id && <div className="mt-2 text-sm text-real-red">{stepErrors.vehicle_id}</div>}
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4">
              {[
                ["consent_background", "I authorize a background and driving-record (MVR) check."],
                ["consent_prepay", "I understand weekly rent is paid in advance."],
              ].map(([k, lbl]) => (
                <label key={k} className="flex items-start gap-3 rounded-2xl bg-soft p-5 cursor-pointer">
                  <input type="checkbox" checked={(f as any)[k]} onChange={(e) => update(k as keyof Form, e.target.checked as any)} className="mt-1 accent-[#CC0000]" />
                  <span className="text-sm">{lbl}</span>
                </label>
              ))}
              <label className="flex items-start gap-3 rounded-2xl bg-soft p-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.consent_terms}
                  onChange={(e) => update("consent_terms", e.target.checked)}
                  className="mt-1 accent-[#CC0000]"
                />
                <span className="text-sm">
                  I agree to the{" "}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setTermsOpen(true); }}
                    className="underline underline-offset-2 text-real-red hover:opacity-80"
                  >
                    terms and conditions
                  </button>
                  .
                </span>
              </label>
              {stepErrors.consents && <div className="text-sm text-real-red">{stepErrors.consents}</div>}
            </div>
          )}
          {step === 5 && (
            <div className="space-y-4 text-sm">
              <EditableSummary
                title="Personal"
                items={[
                  { label: "Name", field: "full_name", value: f.full_name },
                  { label: "Email", field: "email", value: f.email, type: "email" },
                  { label: "Phone", field: "phone", value: f.phone, type: "tel" },
                  { label: "DOB", field: "dob", value: f.dob, type: "date" },
                ]}
                onSave={(field, value) => update(field as keyof Form, value as any)}
              />
              <EditableSummary
                title="License"
                items={[
                  { label: "#", field: "license_number", value: f.license_number },
                  { label: "State", field: "license_state", value: f.license_state },
                  { label: "Expires", field: "license_expiration", value: f.license_expiration, type: "date" },
                ]}
                onSave={(field, value) => update(field as keyof Form, value as any)}
              />
              <EditableSummary
                title="Platforms"
                items={[
                  { label: "Platforms", field: "platforms", value: f.platforms.join(", "), readOnly: true },
                  { label: "Hours/wk", field: "weekly_hours", value: String(f.weekly_hours), type: "number" },
                ]}
                onSave={(field, value) => {
                  if (field === "weekly_hours") update("weekly_hours", Number(value) as any);
                }}
              />
              <EditableSummary
                title="Vehicle"
                items={[
                  {
                    label: "Vehicle",
                    field: "vehicle_id",
                    value: vehicles.find((v) => v.id === f.vehicle_id)
                      ? `${vehicles.find((v) => v.id === f.vehicle_id)?.year} ${vehicles.find((v) => v.id === f.vehicle_id)?.make} ${vehicles.find((v) => v.id === f.vehicle_id)?.model}`
                      : "—",
                    readOnly: true,
                  },
                  { label: "Start", field: "start_date", value: f.start_date, type: "date" },
                  { label: "Term", field: "rental_term", value: f.rental_term, readOnly: true },
                ]}
                onSave={(field, value) => update(field as keyof Form, value as any)}
              />
              {error && <div className="text-real-red">{error}</div>}
            </div>
          )}
          </div>

          {/* RIGHT panel — context changes per step */}
          <aside className="space-y-4 min-w-0 lg:sticky lg:top-6 lg:self-start">
            {step === 3 ? (
              <>
                <In label="Desired start date" type="date" v={f.start_date} e={stepErrors.start_date} on={(v) => update("start_date", v)} />
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rental term</label>
                  <SoftSelect value={f.rental_term} onChange={(v) => update("rental_term", v)} options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "annual", label: "Annual" }]} />
                </div>
                {pricingSummary}
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment method</label>
                  <SoftSelect value={f.payment_method} onChange={(v) => update("payment_method", v)} options={[
                    { value: "debit", label: "Debit" },
                    { value: "credit", label: "Credit" },
                    { value: "ach", label: "Bank Transfer (ACH)" },
                    { value: "applepay", label: "Apple Pay" },
                    { value: "googlepay", label: "Google Pay" },
                    { value: "cashapp", label: "Cash App" },
                    { value: "venmo", label: "Venmo" },
                    { value: "zelle", label: "Zelle" },
                    { value: "paypal", label: "PayPal" },
                    { value: "cash", label: "Cash" },
                  ]} />
                </div>
              </>
            ) : step > 3 && pricingSummary ? (
              pricingSummary
            ) : (
              <StepHelper step={step} />
            )}
          </aside>
        </div>

        {/* Buttons aligned to the far edges of the full-width section */}
        <div className="mt-10 flex items-center justify-between w-full">
          <button onClick={back} className="rounded-lg border border-border px-6 py-3 text-sm">Back</button>
          {step < STEPS.length - 1 ? (
            <button onClick={next} className="rounded-lg bg-black text-white px-7 py-3 text-sm hover:bg-real-red transition active:scale-95">Continue</button>
          ) : (
            <button onClick={submit} className="rounded-lg bg-real-red text-white px-8 py-3 text-sm hover:opacity-90 transition active:scale-95">Submit Application</button>
          )}
        </div>
      </section>
      </main>
      <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>Terms and Conditions</DialogTitle>
            <DialogDescription>Please read carefully before agreeing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-foreground/80 leading-relaxed">
            <p><strong>1. Rental Agreement.</strong> By renting a vehicle from REAL AUTOMOTIVE, you agree to operate the vehicle in accordance with all applicable laws and the terms outlined in your signed rental agreement.</p>
            <p><strong>2. Payment.</strong> Weekly rent is paid in advance. A refundable security deposit is collected at pickup and returned upon vehicle return, less any outstanding tolls, tickets, damages, unpaid balances, cleaning fees, or other charges.</p>
            <p><strong>3. Insurance.</strong> Driver must maintain rideshare-endorsed insurance coverage at all times during the rental period.</p>
            <p><strong>4. Vehicle Use.</strong> Vehicles may only be used for the purposes disclosed in this application, including rideshare and delivery driving. Subleasing is strictly prohibited.</p>
            <p><strong>5. Maintenance.</strong> Routine maintenance is included. Driver is responsible for reporting any mechanical issues immediately.</p>
            <p><strong>6. Tolls & Tickets.</strong> Driver is responsible for all tolls, parking citations, and moving violations incurred during the rental.</p>
            <p><strong>7. Termination.</strong> Either party may terminate the rental with written notice. Vehicle must be returned in the same condition as received, less normal wear and tear.</p>
            <p><strong>8. Background Check.</strong> By agreeing, you consent to a background check and motor vehicle record (MVR) review.</p>
            <p><strong>9. Privacy.</strong> Your information is used solely to process your application and manage your rental. GPS tracking may be active on rental vehicles for security and recovery purposes.</p>
            <p><strong>10. Acceptance.</strong> Checking the box indicates you have read, understood, and agreed to these terms.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function In({ label, v, on, type = "text", e, className = "" }: { label: string; v: string; on: (v: string) => void; type?: string; e?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={v} onChange={(ev) => on(ev.target.value)} className="mt-1 w-full bg-soft rounded-lg px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
      {e && <div className="field-error mt-1 text-xs text-real-red">{e}</div>}
    </div>
  );
}

function SoftSelect({ value, onChange, placeholder = "Select…", options }: { value: string; onChange: (v: string) => void; placeholder?: string; options: { value: string; label: string }[] }) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="mt-1 w-full bg-soft border-0 rounded-lg pl-5 pr-4 py-3 h-auto text-sm shadow-none focus:ring-2 focus:ring-black/10">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="bg-white" position="popper" side="bottom" sideOffset={4} avoidCollisions={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="bg-white focus:bg-soft">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Summary({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="rounded-2xl bg-soft p-5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      <dl className="grid grid-cols-2 gap-y-1">
        {items.map(([k, v]) => (<><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v || "—"}</dd></>))}
      </dl>
    </div>
  );
}

type EditableItem = { label: string; field: string; value: string; type?: string; readOnly?: boolean };

function EditableSummary({
  title,
  items,
  onSave,
}: {
  title: string;
  items: EditableItem[];
  onSave: (field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const start = (it: EditableItem) => {
    if (it.readOnly) return;
    setDraft(it.value);
    setEditing(it.field);
  };
  const commit = (field: string) => {
    onSave(field, draft);
    setEditing(null);
  };

  return (
    <div className="rounded-2xl bg-soft p-5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">{title}</div>
      <div className="divide-y divide-border/40">
        {items.map((it) => {
          const isEditing = editing === it.field;
          return (
            <div key={it.field} className="grid grid-cols-[140px_1fr_auto] items-center gap-3 py-2">
              <div className="text-muted-foreground">{it.label}</div>
              <div className="min-w-0 text-right">
                {isEditing ? (
                  <input
                    autoFocus
                    type={it.type ?? "text"}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(it.field)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit(it.field);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="w-full bg-white rounded-md px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                ) : (
                  <span className="truncate inline-block max-w-full align-middle">{it.value || "—"}</span>
                )}
              </div>
              <div className="w-6 flex justify-end">
                {!it.readOnly && !isEditing && (
                  <button
                    type="button"
                    onClick={() => start(it)}
                    className="text-muted-foreground hover:text-foreground transition"
                    aria-label={`Edit ${it.label}`}
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepHelper({ step }: { step: number }) {
  const content: Record<number, { eyebrow: string; title: string; bullets: string[] }> = {
    0: {
      eyebrow: "What You'll Need",
      title: "A Few Basics To Get Started",
      bullets: [
        "Legal name as it appears on your license",
        "Phone & email we can reach you at",
        "Current home address",
        "You must be 21 or older to drive",
      ],
    },
    1: {
      eyebrow: "License Step",
      title: "Have Your Driver's License Ready",
      bullets: [
        "Active, non-expired US driver's license",
        "Front photo upload (PNG or JPG)",
        "We run a quick MVR check after you submit",
      ],
    },
    2: {
      eyebrow: "Platforms",
      title: "Tell Us Where You Drive",
      bullets: [
        "Pick every platform you plan to drive for",
        "Add custom platforms if yours isn't listed",
        "Estimate your average weekly hours",
      ],
    },
    4: {
      eyebrow: "Consents",
      title: "A Few Final Confirmations",
      bullets: [
        "Background and driving-record check",
        "Rent is paid one week in advance",
        "Standard rental terms apply",
      ],
    },
    5: {
      eyebrow: "Almost Done",
      title: "Review Your Application",
      bullets: [
        "Double-check your details on the left",
        "Most drivers are approved within 24 hours",
        "You'll get an email as soon as we review",
      ],
    },
  };
  const c = content[step] ?? content[0];
  return (
    <div className="rounded-2xl border border-border bg-soft p-5">
      <div className="text-[10px] uppercase tracking-wider text-real-red font-semibold mb-2">{c.eyebrow}</div>
      <div className="text-base font-semibold mb-4">{c.title}</div>
      <ul className="space-y-2.5">
        {c.bullets.map((b) => (
          <li key={b} className="flex gap-2.5 text-sm text-muted-foreground">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-real-red" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}