import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
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

function Apply() {
  const { vehicle: preVehicle } = Route.useSearch();
  const [step, setStep] = useState(0);
  const [vehicles, setVehicles] = useState<Tables<"vehicles">[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState<Form>({
    full_name: "", email: "", phone: "", dob: "",
    address: "", city: "", state: "", zip: "",
    license_number: "", license_state: "", license_expiration: "", years_licensed: 1,
    license_photo_url: "",
    platforms: [], weekly_hours: 30, platform_active: true,
    vehicle_id: preVehicle, start_date: "", rental_term: "weekly", payment_method: "debit",
    consent_gps: false, consent_background: false, consent_prepay: false, consent_terms: false,
  });
  const update = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    supabase.from("vehicles").select("*").eq("status", "available").order("make").then(({ data }) => setVehicles(data || []));
  }, []);

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
      if (!f.consent_gps || !f.consent_background || !f.consent_prepay || !f.consent_terms)
        errs.consents = "All consents are required";
    }
    setStepErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  async function submit() {
    if (!validateStep()) return;
    setError(null);
    const payload = { ...f, vehicle_id: f.vehicle_id || null, dob: f.dob || null, license_expiration: f.license_expiration || null, start_date: f.start_date || null };
    const { error } = await supabase.from("applications").insert(payload as any);
    if (error) setError(error.message); else setSubmitted(true);
  }

  if (submitted) {
    return (
      <SiteLayout>
        <div className="container-real py-32 text-center">
          <FadeUp>
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Done</div>
            <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Application Received.</h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
              We Review Most Applications Within 24 Hours. Check your email — we'll be in touch.
            </p>
            <Link to="/fleet" className="mt-10 inline-flex rounded-full bg-black px-7 py-3 text-sm font-medium text-white hover:bg-real-red transition">
              Back to fleet
            </Link>
          </FadeUp>
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <section className="container-real pt-12 md:pt-20 pb-24 max-w-3xl mx-auto">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Apply</div>
          <h1 className="mt-3 text-3xl md:text-5xl font-semibold">Tell Us About You.</h1>
        </FadeUp>

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
                <In label="State" v={f.state} on={(v) => update("state", v)} />
                <In label="ZIP" v={f.zip} on={(v) => update("zip", v)} />
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <In label="License number" v={f.license_number} e={stepErrors.license_number} on={(v) => update("license_number", v)} />
              <In label="License state" v={f.license_state} e={stepErrors.license_state} on={(v) => update("license_state", v)} />
              <In label="Expiration" type="date" v={f.license_expiration} e={stepErrors.license_expiration} on={(v) => update("license_expiration", v)} />
              <In label="Years licensed" type="number" v={String(f.years_licensed)} on={(v) => update("years_licensed", Number(v))} />
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">License photo (front)</label>
                <input
                  type="file" accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const path = `${Date.now()}-${file.name}`;
                    const { error } = await supabase.storage.from("license-uploads").upload(path, file);
                    if (!error) update("license_photo_url", path);
                  }}
                  className="mt-2 block w-full text-sm"
                />
                {f.license_photo_url && <div className="mt-2 text-xs text-muted-foreground">Uploaded.</div>}
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
                      className={`rounded-full px-5 py-2 text-sm border transition ${on ? "bg-black text-white border-black" : "border-border hover:border-black"}`}>
                      {p}
                    </button>
                  );
                })}
              </div>
              {stepErrors.platforms && <div className="mt-2 text-sm text-real-red">{stepErrors.platforms}</div>}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <In label="Weekly hours" type="number" v={String(f.weekly_hours)} on={(v) => update("weekly_hours", Number(v))} />
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Active account?</label>
                  <select value={String(f.platform_active)} onChange={(e) => update("platform_active", e.target.value === "true")} className="mt-1 w-full bg-soft rounded-full px-5 py-3 text-sm">
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
                <select value={f.vehicle_id} onChange={(e) => update("vehicle_id", e.target.value)} className="mt-1 w-full bg-soft rounded-full px-5 py-3 text-sm">
                  <option value="">Select…</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.year} {v.make} {v.model} — ${Number(v.weekly_rate)}/wk</option>)}
                </select>
                {stepErrors.vehicle_id && <div className="mt-1 text-sm text-real-red">{stepErrors.vehicle_id}</div>}
              </div>
              <In label="Desired start date" type="date" v={f.start_date} e={stepErrors.start_date} on={(v) => update("start_date", v)} />
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rental term</label>
                <select value={f.rental_term} onChange={(e) => update("rental_term", e.target.value)} className="mt-1 w-full bg-soft rounded-full px-5 py-3 text-sm">
                  <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="long_term">Long-term</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment method</label>
                <select value={f.payment_method} onChange={(e) => update("payment_method", e.target.value)} className="mt-1 w-full bg-soft rounded-full px-5 py-3 text-sm">
                  <option value="debit">Debit</option><option value="credit">Credit</option><option value="cashapp">Cash App</option>
                </select>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4">
              {[
                ["consent_gps", "I consent to a GPS tracking device on the vehicle."],
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
          <button onClick={back} disabled={step === 0} className="rounded-full border border-border px-6 py-3 text-sm disabled:opacity-30">Back</button>
          {step < STEPS.length - 1 ? (
            <button onClick={next} className="rounded-full bg-black text-white px-7 py-3 text-sm hover:bg-real-red transition active:scale-95">Continue</button>
          ) : (
            <button onClick={submit} className="rounded-full bg-real-red text-white px-8 py-3 text-sm hover:opacity-90 transition active:scale-95">Submit Application</button>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}

function In({ label, v, on, type = "text", e, className = "" }: { label: string; v: string; on: (v: string) => void; type?: string; e?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={v} onChange={(ev) => on(ev.target.value)} className="mt-1 w-full bg-soft rounded-full px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10" />
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