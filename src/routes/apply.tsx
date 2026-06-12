import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { FadeUp } from "@/components/site/FadeUp";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { z } from "zod";

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

  const next = () => { if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const back = () => window.history.back();

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

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Nav />
        <main className="flex-1 container-real py-32 text-center">
          <FadeUp>
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Done</div>
            <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Application Received.</h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
              We Review Most Applications Within 24 Hours. Check your email — we'll be in touch.
            </p>
            <Link to="/fleet" className="mt-10 inline-flex rounded-lg bg-black px-7 py-3 text-sm font-medium text-white hover:bg-real-red transition">
              Back to fleet
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
      <section className="container-real pt-12 md:pt-20 pb-24 max-w-3xl mx-auto">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Apply</div>
          <h1 className="mt-3 text-3xl md:text-5xl font-semibold">Tell Us About You.</h1>
        </FadeUp>

        {selectedVehicle && (
          <FadeUp>
            <div className="mt-8 rounded-2xl border border-border bg-soft p-5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Pricing Summary</div>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <div className="text-muted-foreground">Vehicle</div>
                <div className="text-right font-medium">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</div>
                <div className="text-muted-foreground">Weekly Rental</div>
                <div className="text-right font-medium">${Number(selectedVehicle.weekly_rate)}/week</div>
                <div className="text-muted-foreground">Refundable Security Deposit</div>
                <div className="text-right font-medium">${Number(selectedVehicle.deposit ?? 0)}</div>
                <div className="col-span-2 border-t border-border my-1" />
                <div className="font-semibold">Due At Pickup</div>
                <div className="text-right font-semibold text-real-red">
                  ${Number(selectedVehicle.weekly_rate) + Number(selectedVehicle.deposit ?? 0)}
                </div>
              </div>
              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                Your security deposit is fully refundable upon vehicle return, less any
                outstanding tolls, tickets, damages, unpaid balances, cleaning fees, or
                other charges outlined in the rental agreement.
              </p>
            </div>
          </FadeUp>
        )}

        <div className="mt-10">
          <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
            <div>Step {step + 1} of {STEPS.length} — {STEPS[step]}</div>
            <div>{Math.round(((step + 1) / STEPS.length) * 100)}%</div>
          </div>
          <div className="h-1 bg-soft rounded-full overflow-hidden">
            <div className="h-full bg-real-red transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        <div className="mt-10">
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
                  <select value={f.state} onChange={(e) => update("state", e.target.value)} className="mt-1 w-full bg-soft rounded-lg pl-5 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10">
                    <option value="">Select…</option>
                    {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
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
                <select value={f.license_state} onChange={(e) => update("license_state", e.target.value)} className="mt-1 w-full bg-soft rounded-lg pl-5 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10">
                  <option value="">Select…</option>
                  {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
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
                  <select value={String(f.platform_active)} onChange={(e) => update("platform_active", e.target.value === "true")} className="mt-1 w-full bg-soft rounded-lg pl-5 pr-10 py-3 text-sm">
                    <option value="true">Yes</option><option value="false">No, I'll sign up</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Preferred vehicle</label>
                <select value={f.vehicle_id} onChange={(e) => update("vehicle_id", e.target.value)} className="mt-1 w-full bg-soft rounded-lg pl-5 pr-10 py-3 text-sm">
                  <option value="">Select…</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.year} {v.make} {v.model} — ${Number(v.weekly_rate)}/wk</option>)}
                </select>
                {stepErrors.vehicle_id && <div className="mt-1 text-sm text-real-red">{stepErrors.vehicle_id}</div>}
              </div>
              <In label="Desired start date" type="date" v={f.start_date} e={stepErrors.start_date} on={(v) => update("start_date", v)} />
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rental term</label>
                <select value={f.rental_term} onChange={(e) => update("rental_term", e.target.value)} className="mt-1 w-full bg-soft rounded-lg pl-5 pr-10 py-3 text-sm">
                  <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="long_term">Long-term</option>
                </select>
                {f.rental_term === "weekly" && selectedVehicle && weeklyToMonthlySavings > 0 && (
                  <div className="mt-3 rounded-xl bg-real-red/5 border border-real-red/20 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="font-semibold text-real-red">Save ~${weeklyToMonthlySavings} / month</span>
                        <span className="text-muted-foreground ml-1">by switching to Monthly</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => update("rental_term", "monthly")}
                        className="shrink-0 rounded-lg bg-real-red px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition"
                      >
                        Switch
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment method</label>
                <select value={f.payment_method} onChange={(e) => update("payment_method", e.target.value)} className="mt-1 w-full bg-soft rounded-lg pl-5 pr-10 py-3 text-sm">
                  <option value="debit">Debit</option><option value="credit">Credit</option><option value="cashapp">Cash App</option>
                </select>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4">
              {[
                ["consent_background", "I authorize a background and driving-record (MVR) check."],
                ["consent_prepay", "I understand weekly rent is paid in advance."],
                ["consent_terms", "I agree to the terms and conditions."],
              ].map(([k, lbl]) => (
                <label key={k} className="flex items-start gap-3 rounded-2xl bg-soft p-5 cursor-pointer">
                  <input type="checkbox" checked={(f as any)[k]} onChange={(e) => update(k as keyof Form, e.target.checked as any)} className="mt-1 accent-[#CC0000]" />
                  <span className="text-sm">{lbl}</span>
                </label>
              ))}
              {stepErrors.consents && <div className="text-sm text-real-red">{stepErrors.consents}</div>}
            </div>
          )}
          {step === 5 && (
            <div className="space-y-4 text-sm">
              <Summary title="Personal" items={[["Name", f.full_name], ["Email", f.email], ["Phone", f.phone], ["DOB", f.dob]]} />
              <Summary title="License" items={[["#", f.license_number], ["State", f.license_state], ["Expires", f.license_expiration]]} />
              <Summary title="Platforms" items={[["Platforms", f.platforms.join(", ")], ["Hours/wk", String(f.weekly_hours)]]} />
              <Summary title="Vehicle" items={[["Vehicle", vehicles.find((v) => v.id === f.vehicle_id) ? `${vehicles.find((v) => v.id === f.vehicle_id)?.year} ${vehicles.find((v) => v.id === f.vehicle_id)?.make} ${vehicles.find((v) => v.id === f.vehicle_id)?.model}` : "—"], ["Start", f.start_date], ["Term", f.rental_term]]} />
              {error && <div className="text-real-red">{error}</div>}
            </div>
          )}
        </div>

        <div className="mt-10 flex items-center justify-between">
          <button onClick={back} className="rounded-lg border border-border px-6 py-3 text-sm">Back</button>
          {step < STEPS.length - 1 ? (
            <button onClick={next} className="rounded-lg bg-black text-white px-7 py-3 text-sm hover:bg-real-red transition active:scale-95">Continue</button>
          ) : (
            <button onClick={submit} className="rounded-lg bg-real-red text-white px-8 py-3 text-sm hover:opacity-90 transition active:scale-95">Submit Application</button>
          )}
        </div>
      </section>
      </main>
    </div>
  );
}

function In({ label, v, on, type = "text", e, className = "" }: { label: string; v: string; on: (v: string) => void; type?: string; e?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={v} onChange={(ev) => on(ev.target.value)} className="mt-1 w-full bg-soft rounded-lg px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
      {e && <div className="mt-1 text-xs text-real-red">{e}</div>}
    </div>
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