import { PhoneInput } from "@/components/ui/phone-input";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { FadeUp } from "@/components/site/FadeUp";
import { startPartnerIntake, finishPartnerIntake } from "@/lib/partner-intake.functions";
import { Banknote, ShieldCheck, MapPin, Wrench, KeySquare, Cog, Satellite, FileText, Umbrella } from "lucide-react";
import { intakeFileProblem } from "@/lib/partner-portal";
import {
  EMPTY_FILES, EMPTY_VEHICLE, Field, PartnerVehicleFields, Select, US_STATES, filesPayload, validateVehicle, vehiclePayload,
  type VehicleFiles, type VehicleFormState,
} from "@/components/partner/PartnerVehicleFields";
import { newIdempotencyKey, uploadPlanned } from "@/components/partner/partner-upload";

export const Route = createFileRoute("/partners")({
  head: () => ({
    meta: [
      { title: "Partner Program — REAL RENTALS" },
      { name: "description", content: "You own the car, we run everything. Place your idle vehicle in the Real Rentals fleet and earn monthly payouts. Fully managed. You keep the title." },
      { property: "og:title", content: "You Own The Car. We Run Everything." },
      { property: "og:description", content: "Real Rentals's Partner Program — we screen drivers, GPS-track every car, and handle maintenance and recovery. You keep the title." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://drivereal.com/partners" }],
  }),
  component: Partners,
});

const BENEFITS = [
  { I: Banknote, t: "Monthly Payouts", d: "A transparent revenue split on every dollar of rent your car collects." },
  { I: ShieldCheck, t: "We Screen Drivers", d: "Background, MVR, identity, and platform checks on every renter." },
  { I: Umbrella, t: "Insurance Included", d: "Every vehicle in our program is covered by insurance we include and set up." },
  { I: MapPin, t: "GPS & Recovery", d: "Every car is GPS-tracked, with recovery and asset protection included." },
  { I: Wrench, t: "Full-Service Ops", d: "Maintenance, registration help, claims, and collections — handled." },
];

const TRUST = [
  { Icon: KeySquare, label: "You Keep The Title" },
  { Icon: ShieldCheck, label: "Insurance Setup" },
  { Icon: Cog, label: "Fully Managed" },
  { Icon: Satellite, label: "GPS Tracked" },
  { Icon: FileText, label: "Monthly Statements" },
];

const FAQS = [
  { q: "Do I keep the title to my vehicle?", a: "Yes. The title stays in your name at all times. We operate the vehicle on your behalf under a written management agreement." },
  { q: "How do payouts work?", a: "Rent is collected weekly from the driver. After pass-through costs, you receive a monthly payout and a statement showing what was collected and what was deducted." },
  { q: "Who pays for maintenance and repairs?", a: "We coordinate routine maintenance and most repairs. Costs are itemized on your monthly statement and deducted before the payout." },
  { q: "Is insurance included for my vehicle?", a: "Yes. We include insurance for every vehicle in our program. Once a renter signs their contract, we handle the insurance quote and set up the policy, issued in the renter's name." },
  { q: "How do you screen the drivers?", a: "Every driver passes a background check, MVR review, ID verification, and platform eligibility check before they're placed in a vehicle." },
  { q: "What if a driver stops paying or disappears?", a: "Every car is GPS-tracked. We handle collections and, if needed, recover the vehicle ourselves." },
  { q: "Can I pull my car out of the program?", a: "Yes. Cancel with reasonable notice and we'll transition the driver and return your vehicle in the agreed condition." },
  { q: "Do I need to live in Tampa?", a: "No. Most owners are out-of-state. We handle all local operations, handoffs, inspections, and maintenance." },
];

type ContactState = {
  full_name: string; email: string; phone: string; business_name: string;
  address_line1: string; address_line2: string; city: string; state: string; postal_code: string;
};

const EMPTY_CONTACT: ContactState = {
  full_name: "", email: "", phone: "", business_name: "", address_line1: "", address_line2: "", city: "", state: "", postal_code: "",
};

function Partners() {
  const formRef = useRef<HTMLDivElement | null>(null);
  const [contact, setContact] = useState<ContactState>(EMPTY_CONTACT);
  const [vehicle, setVehicle] = useState<VehicleFormState>(EMPTY_VEHICLE);
  const [files, setFiles] = useState<VehicleFiles>(EMPTY_FILES);
  const [smsConsent, setSmsConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; missing: string[] } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // One key per form fill: a retry after a network error lands on the same row.
  const idemRef = useRef<string>(newIdempotencyKey());

  function setC<K extends keyof ContactState>(k: K, v: string) {
    setContact((c) => ({ ...c, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function validate(): boolean {
    const e: Record<string, string | undefined> = { ...validateVehicle(vehicle) };
    if (!contact.full_name.trim()) e.full_name = "Required";
    if (!contact.email.trim()) e.email = "Required";
    else if (!/^\S+@\S+\.\S+$/.test(contact.email)) e.email = "Enter a valid email";
    if (contact.phone.replace(/\D/g, "").length < 10) e.phone = "Enter a 10-digit phone number";
    const { meta } = filesPayload(files);
    const fileProblem = meta.map(intakeFileProblem).find(Boolean);
    if (fileProblem) e.files = fileProblem;
    for (const k of Object.keys(e)) if (!e[k]) delete e[k];
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { list, meta } = filesPayload(files);
      setProgress("Saving your details…");
      const started = await startPartnerIntake({
        data: {
          idempotencyKey: idemRef.current,
          contact: {
            full_name: contact.full_name.trim(),
            email: contact.email.trim(),
            phone: contact.phone.trim(),
            business_name: contact.business_name.trim() || null,
            address_line1: contact.address_line1.trim() || null,
            address_line2: contact.address_line2.trim() || null,
            city: contact.city.trim() || null,
            state: contact.state || null,
            postal_code: contact.postal_code.trim() || null,
            sms_consent: smsConsent,
          },
          vehicle: vehiclePayload(vehicle),
          files: meta,
        },
      });
      const up = await uploadPlanned(started.uploads, list, (d, t) => setProgress(`Uploading files ${d}/${t}…`));
      setProgress("Finishing…");
      await finishPartnerIntake({ data: { submissionId: started.submissionId, idempotencyKey: idemRef.current, uploaded: up.uploaded } });
      setSent({ email: contact.email.trim(), missing: up.failed });
    } catch (err: any) {
      setSubmitError(err?.message || "Something went wrong. Please try again — your details are saved and won't be duplicated.");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <SiteLayout>
      {/* Hero */}
      <section className="container-real pt-20 md:pt-28 pb-12 text-center">
        <FadeUp>
          <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red ">Partner Program</div>
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
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red ">Operator Track Record</div>
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
        <div className="container-real max-w-[1440px] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-7 xl:gap-5">
          {BENEFITS.map((b, i) => (
            <FadeUp key={b.t} delay={i * 60}>
              <div className="rounded-2xl bg-white p-7 xl:p-6 h-full border border-border">
                <b.I className="w-6 h-6 text-real-red" strokeWidth={1.75} />
                <div className="mt-5 whitespace-nowrap text-base font-semibold">{b.t}</div>
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
            <div className="mt-8 rounded-2xl bg-soft p-10 text-center" data-testid="partner-intake-done">
              <h3 className="text-2xl font-semibold">Thanks — We Got Your Vehicle.</h3>
              <p className="mt-3 text-muted-foreground">We'll review it and reach out within 24 hours to set up a call.</p>
              {sent.missing.length > 0 && (
                <p className="mt-3 text-sm text-real-red">These files didn't upload: {sent.missing.join(", ")}. We'll collect them when we call.</p>
              )}
              <p className="mt-6 text-sm text-muted-foreground">Create your partner portal login with <strong>{sent.email}</strong> to follow your submission, add more vehicles, and later see rentals, earnings and payouts.</p>
              <a href={`/partner?signup=1&email=${encodeURIComponent(sent.email)}`} className="mt-4 inline-flex rounded-lg bg-black px-6 py-3 text-sm font-medium text-white hover:opacity-90">Create Partner Login</a>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="partner-intake-form">
              <h3 className="md:col-span-2 text-sm font-semibold tracking-wider text-muted-foreground">About You</h3>
              <Field label="Full Name" value={contact.full_name} onChange={(v) => setC("full_name", v)} error={errors.full_name} autoComplete="name" />
              <Field label="Email" type="email" value={contact.email} onChange={(v) => setC("email", v)} error={errors.email} autoComplete="email" />
              <div>
                <label className="text-[10px] tracking-wider text-muted-foreground">Phone</label>
                <PhoneInput mode="us" value={contact.phone} onValueChange={(v) => setC("phone", v)} className={`mt-1 w-full bg-soft rounded-lg px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 ${errors.phone ? "ring-2 ring-real-red/40" : ""}`} />
                {errors.phone && <div className="mt-1 text-xs text-real-red">{errors.phone}</div>}
              </div>
              <Field label="Business Name (Optional)" value={contact.business_name} onChange={(v) => setC("business_name", v)} autoComplete="organization" />
              <Field label="Street Address" value={contact.address_line1} onChange={(v) => setC("address_line1", v)} autoComplete="address-line1" />
              <Field label="Apt / Suite (Optional)" value={contact.address_line2} onChange={(v) => setC("address_line2", v)} autoComplete="address-line2" />
              <Field label="City" value={contact.city} onChange={(v) => setC("city", v)} autoComplete="address-level2" />
              <div className="grid grid-cols-2 gap-4">
                <Select label="State" value={contact.state} onChange={(v) => setC("state", v)} options={US_STATES} />
                <Field label="ZIP" value={contact.postal_code} onChange={(v) => setC("postal_code", v.replace(/[^0-9-]/g, "").slice(0, 10))} inputMode="numeric" autoComplete="postal-code" />
              </div>

              <h3 className="md:col-span-2 mt-4 text-sm font-semibold tracking-wider text-muted-foreground">Your Vehicle</h3>
              <PartnerVehicleFields value={vehicle} onChange={(v) => { setVehicle(v); setErrors((e) => ({ ...e, vin: undefined, year: undefined, make: undefined, model: undefined })); }}
                errors={errors as any} files={files} onFiles={(f) => { setFiles(f); setErrors((e) => ({ ...e, files: undefined })); }} disabled={submitting} />
              {errors.files && <div className="md:col-span-2 text-xs text-real-red">{errors.files}</div>}

              <label className="md:col-span-2 flex items-start gap-3 text-xs text-muted-foreground">
                <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                <span>Text me updates about my vehicle (for example, when it goes out on rent). Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out. Not required to join.</span>
              </label>

              {submitError && <div className="md:col-span-2 text-sm text-real-red">{submitError}</div>}

              <div className="md:col-span-2 flex flex-col items-start gap-3">
                <button disabled={submitting} className="rounded-lg bg-real-red px-7 py-3 text-sm font-medium text-white hover:opacity-90 transition active:scale-95 disabled:opacity-60">
                  {submitting ? (progress ?? "Submitting…") : "Submit Vehicle"}
                </button>
                <p className="text-xs text-muted-foreground">
                  You keep the title at all times · Insurance included for the renter · Cancel with notice. Already a partner? <a href="/partner" className="underline">Sign in</a>.
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
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red ">Owner FAQ</div>
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
