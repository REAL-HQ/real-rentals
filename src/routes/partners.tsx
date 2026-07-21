import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { supabase } from "@/integrations/supabase/client";
import { Banknote, ShieldCheck, MapPin, Wrench, KeySquare, Cog, Satellite, FileText, Upload, X } from "lucide-react";

export const Route = createFileRoute("/partners")({
  head: () => ({
    meta: [
      { title: "Partner Program — REAL RENTALS" },
      { name: "description", content: "You own the car, we run everything. Place your idle vehicle in the Real Rentals fleet and earn monthly payouts. Fully managed. You keep the title." },
      { property: "og:title", content: "You Own The Car. We Run Everything." },
      { property: "og:description", content: "Real Rentals's Partner Program — we screen drivers, GPS-track every car, and handle maintenance and recovery. You keep the title." },
    ],
  }),
  component: Partners,
});

const BENEFITS = [
  { I: Banknote, t: "Monthly Payouts", d: "A transparent revenue split on every dollar of rent your car collects." },
  { I: ShieldCheck, t: "We Screen Drivers", d: "Background, MVR, identity, and platform checks on every renter." },
  { I: MapPin, t: "GPS & Recovery", d: "Every car is GPS-tracked, with recovery and asset protection included." },
  { I: Wrench, t: "Full-Service Ops", d: "Maintenance, registration help, claims, and collections — handled." },
];

const TRUST = [
  { Icon: KeySquare, label: "You Keep The Title" },
  { Icon: Cog, label: "Fully Managed" },
  { Icon: Satellite, label: "GPS Tracked" },
  { Icon: FileText, label: "Monthly Statements" },
];

const FAQS = [
  { q: "Do I keep the title to my vehicle?", a: "Yes. The title stays in your name at all times. We operate the vehicle on your behalf under a written management agreement." },
  { q: "How do payouts work?", a: "Rent is collected weekly from the driver. After pass-through costs, you receive a monthly payout and a statement showing what was collected and what was deducted." },
  { q: "Who pays for maintenance and repairs?", a: "We coordinate routine maintenance and most repairs. Costs are itemized on your monthly statement and deducted before the payout." },
  { q: "What about insurance?", a: "Insurance options are available through our commercial program. We'll walk through what's required and what's optional during your call." },
  { q: "How do you screen the drivers?", a: "Every driver passes a background check, MVR review, ID verification, and platform eligibility check before they're placed in a vehicle." },
  { q: "What if a driver stops paying or disappears?", a: "Every car is GPS-tracked. We handle collections and, if needed, recover the vehicle ourselves." },
  { q: "Can I pull my car out of the program?", a: "Yes. Cancel with reasonable notice and we'll transition the driver and return your vehicle in the agreed condition." },
  { q: "Do I need to live in Tampa?", a: "No. Most owners are out-of-state. We handle all local operations, handoffs, inspections, and maintenance." },
];

const TITLE_STATUSES = ["Clean", "Salvage", "Rebuilt", "Not sure"];
const LIEN_STATUSES = ["Owned free and clear", "Financed — still making payments"];
const CONDITIONS = ["Excellent", "Good", "Fair"];
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  mileage: string;
  title_status: string;
  lien_status: string;
  registration_state: string;
  currently_insured: string;
  condition: string;
  message: string;
};

const EMPTY: FormState = {
  full_name: "", email: "", phone: "", vin: "", year: "", make: "", model: "",
  trim: "", mileage: "", title_status: "", lien_status: "", registration_state: "",
  currently_insured: "", condition: "", message: "",
};

function Partners() {
  const formRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos, ...Array.from(files)].slice(0, 6);
    setPhotos(next);
  }

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.full_name.trim()) e.full_name = "Required";
    if (!form.email.trim()) e.email = "Required";
    else if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = "Enter a valid email";
    if (!form.phone.trim()) e.phone = "Required";
    if (!form.vin.trim()) e.vin = "Required";
    else if (form.vin.trim().length !== 17) e.vin = "VIN must be 17 characters";
    if (!form.year.trim()) e.year = "Required";
    else if (!/^\d{4}$/.test(form.year)) e.year = "Enter a 4-digit year";
    if (!form.make.trim()) e.make = "Required";
    if (!form.model.trim()) e.model = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      // Insert the submission first so uploads can be scoped to its id. RLS
      // ties storage writes to a real submission row rather than trusting an
      // arbitrary client-chosen UUID.
      const submissionId = crypto.randomUUID();
      const { error } = await supabase.from("fleet_owner_submissions").insert({
        id: submissionId,
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        vin: form.vin.trim().toUpperCase(),
        year: Number(form.year),
        make: form.make.trim(),
        model: form.model.trim(),
        trim: form.trim.trim() || null,
        mileage: form.mileage ? Number(form.mileage) : null,
        title_status: form.title_status || null,
        lien_status: form.lien_status || null,
        registration_state: form.registration_state || null,
        currently_insured: form.currently_insured === "" ? null : form.currently_insured === "Yes",
        condition: form.condition || null,
        photo_urls: [],
        message: form.message.trim() || null,
      });
      if (error) throw error;
      const photo_urls: string[] = [];
      for (const file of photos) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${submissionId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("owner-vehicle-photos").upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        photo_urls.push(path);
      }
      if (photo_urls.length) {
        await supabase.from("fleet_owner_submissions").update({ photo_urls }).eq("id", submissionId);
      }
      setSent(true);
    } catch (err: any) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SiteLayout>
      {/* Hero */}
      <section className="container-real pt-20 md:pt-28 pb-12 text-center">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Partner Program</div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold max-w-3xl mx-auto leading-[1.05]">
            You Own The Car.
            <br />
            We Run Everything.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Already have a vehicle sitting idle? Place it in the Real Rentals
            fleet and earn a monthly revenue split. You keep the title. We find and
            screen the drivers, collect rent, track every car by GPS, and handle
            maintenance and recovery.
          </p>
          <div className="mt-8 flex justify-center">
            <button
              onClick={scrollToForm}
              className="inline-flex items-center justify-center rounded-lg bg-black text-white px-8 py-4 text-sm md:text-base font-medium hover:opacity-90 transition active:scale-95"
            >
              Enroll Your Vehicle
            </button>
          </div>
        </FadeUp>
      </section>

      {/* Owner trust strip */}
      <section className="border-y border-border bg-soft">
        <div className="container-real py-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs md:text-sm text-foreground/80">
          {TRUST.map(({ Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5 text-real-red" strokeWidth={2.25} />
              <span className="font-medium">{label}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Founder operator credibility */}
      <section className="bg-white py-12 md:py-16">
        <div className="container-real">
          <FadeUp className="mx-auto max-w-3xl rounded-2xl border border-border bg-soft p-8 md:p-10 text-center">
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Operator Track Record</div>
            <h2 className="mt-3 text-2xl md:text-3xl font-semibold leading-tight">
              700+ Five-Star Rentals.
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Our founder has personally completed 700+ five-star rentals on Turo — a public,
              verifiable track record of running rental vehicles safely, profitably, and at
              scale. The same operating discipline runs the Real Rentals fleet your car
              joins.
            </p>
            <p className="mt-3 text-xs text-muted-foreground/80">
              Founder's personal Turo history. Turo is a separate travel-rental channel and
              is not used for rideshare.
            </p>
          </FadeUp>
        </div>
      </section>

      {/* Benefit cards */}
      <section className="bg-soft py-20">
        <div className="container-real grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-7">
          {BENEFITS.map((b, i) => (
            <FadeUp key={b.t} delay={i * 60}>
              <div className="rounded-2xl bg-white p-7 h-full border border-border">
                <b.I className="w-6 h-6 text-real-red" strokeWidth={1.75} />
                <div className="mt-5 text-lg font-semibold">{b.t}</div>
                <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{b.d}</div>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* Vehicle intake form */}
      <section className="container-real py-20" ref={formRef}>
        <div className="max-w-3xl mx-auto">
          <FadeUp>
            <h2 className="text-3xl md:text-4xl font-semibold">Tell Us About Your Vehicle</h2>
            <p className="mt-3 text-muted-foreground">A few details and we'll set up a call to walk through the program.</p>
          </FadeUp>
          {sent ? (
            <div className="mt-8 rounded-2xl bg-soft p-10 text-center">
              <h3 className="text-2xl font-semibold">Thanks.</h3>
              <p className="mt-3 text-muted-foreground">We'll review your vehicle and reach out within 24 hours to set up a call.</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full name" value={form.full_name} onChange={(v) => set("full_name", v)} error={errors.full_name} />
              <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} error={errors.email} />
              <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} error={errors.phone} />
              <Field label="VIN (17 characters)" value={form.vin} onChange={(v) => set("vin", v.toUpperCase().slice(0, 17))} error={errors.vin} />
              <Field label="Year" value={form.year} onChange={(v) => set("year", v.replace(/\D/g, "").slice(0, 4))} error={errors.year} />
              <Field label="Make" value={form.make} onChange={(v) => set("make", v)} error={errors.make} />
              <Field label="Model" value={form.model} onChange={(v) => set("model", v)} error={errors.model} />
              <Field label="Trim (optional)" value={form.trim} onChange={(v) => set("trim", v)} />
              <Field label="Current mileage" value={form.mileage} onChange={(v) => set("mileage", v.replace(/\D/g, ""))} />
              <Select label="Title status" value={form.title_status} onChange={(v) => set("title_status", v)} options={TITLE_STATUSES} />
              <Select label="Lien status" value={form.lien_status} onChange={(v) => set("lien_status", v)} options={LIEN_STATUSES} />
              <Select label="Registration state" value={form.registration_state} onChange={(v) => set("registration_state", v)} options={US_STATES} />
              <Select label="Currently insured" value={form.currently_insured} onChange={(v) => set("currently_insured", v)} options={["Yes", "No"]} />
              <Select label="Vehicle condition" value={form.condition} onChange={(v) => set("condition", v)} options={CONDITIONS} />

              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Vehicle photos (4–6)</label>
                <label className="mt-1 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-soft py-8 cursor-pointer hover:border-foreground/40 transition">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">Click to upload photos</div>
                  <div className="text-xs text-muted-foreground/70">{photos.length}/6 selected</div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => onPhotos(e.target.files)}
                  />
                </label>
                {photos.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-soft">
                        <img src={URL.createObjectURL(p)} alt={`Vehicle ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 rounded-full bg-black/70 text-white p-1 hover:bg-black"
                          aria-label="Remove photo"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Message (optional)</label>
                <textarea
                  value={form.message}
                  onChange={(e) => set("message", e.target.value)}
                  rows={4}
                  className="mt-1 w-full bg-soft rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                />
              </div>

              {submitError && (
                <div className="md:col-span-2 text-sm text-real-red">{submitError}</div>
              )}

              <div className="md:col-span-2 flex flex-col items-start gap-3">
                <button
                  disabled={submitting}
                  className="rounded-lg bg-real-red px-7 py-3 text-sm font-medium text-white hover:opacity-90 transition active:scale-95 disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Submit Vehicle"}
                </button>
                <p className="text-xs text-muted-foreground">
                  You keep the title at all times · Insurance options available · Cancel with notice.
                </p>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="container-real pb-24">
        <FadeUp>
          <div className="text-center mb-10">
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Owner FAQ</div>
            <h2 className="mt-3 text-3xl md:text-5xl font-semibold">Common Questions</h2>
          </div>
        </FadeUp>
        <FadeUp>
          <div className="max-w-3xl mx-auto divide-y divide-border rounded-2xl border border-border">
            {FAQS.map((f) => (
              <details key={f.q} className="group p-6">
                <summary className="cursor-pointer flex items-center justify-between text-base font-medium list-none">
                  {f.q}
                  <span className="text-muted-foreground group-open:rotate-45 transition-transform text-2xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </FadeUp>
      </section>

      {/* Final CTA band */}
      <section className="bg-real-red text-white">
        <div className="container-real py-14 md:py-20 flex flex-col items-center gap-8 text-center">
          <div>
            <div className="text-3xl md:text-5xl font-semibold leading-tight">Turn Your Idle Car Into Monthly Income.</div>
            <div className="mt-3 text-base md:text-lg text-white/90">Fully managed. You keep the title.</div>
          </div>
          <button
            onClick={scrollToForm}
            className="inline-flex items-center justify-center rounded-lg bg-white text-real-red px-10 py-5 text-base md:text-lg font-bold shadow-xl hover:scale-[1.03] hover:shadow-2xl transition active:scale-95"
          >
            Enroll Your Vehicle
          </button>
        </div>
      </section>
    </SiteLayout>
  );
}

function Field({ label, value, onChange, type = "text", error }: { label: string; value: string; onChange: (v: string) => void; type?: string; error?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full bg-soft rounded-lg px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 ${error ? "ring-2 ring-real-red/40" : ""}`}
      />
      {error && <div className="mt-1 text-xs text-real-red">{error}</div>}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const formatOption = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref}>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="relative mt-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full bg-soft text-foreground rounded-lg pl-5 pr-12 py-3 text-left text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {value ? formatOption(value) : "Select…"}
        </button>
        <svg className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
        {open && (
          <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-white shadow-xl" role="listbox">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="block w-full bg-white px-5 py-3 text-left text-sm text-foreground hover:bg-soft focus:bg-soft focus:outline-none"
              role="option"
              aria-selected={value === ""}
            >
              Select…
            </button>
            {options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className="block w-full bg-white px-5 py-3 text-left text-sm text-foreground hover:bg-soft focus:bg-soft focus:outline-none"
                role="option"
                aria-selected={value === o}
              >
                {formatOption(o)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}