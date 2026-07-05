import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Check, Loader2, Mail, Upload, Car, CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getApplicationForWizard, updateApplicationStep } from "@/lib/applications.functions";
import { FadeUp } from "./FadeUp";

type WizardStep = "eligibility" | "rental" | "gig" | "driver" | "complete";

const WIZARD_STEPS: WizardStep[] = ["eligibility", "rental", "gig", "driver"];
const STEP_LABELS: Record<WizardStep, string> = {
  eligibility: "Eligibility",
  rental: "Rental",
  gig: "Profile",
  driver: "Driver",
  complete: "Done",
};

// Progress bar segments, driven by entry path. Homepage users completed the
// contact ("Your Info") step in /apply's ContactStep before the wizard mounted,
// so it's the first bar segment. City-page users submitted contact info in the
// hero form (outside the wizard), so their bar starts at Eligibility.
export function getBarSegments(source: string | null | undefined): {
  key: string;
  label: string;
}[] {
  const wizard = WIZARD_STEPS.map((s) => ({ key: s, label: STEP_LABELS[s] }));
  const done = { key: "complete", label: "Done" };
  if (source === "homepage") {
    return [{ key: "your_info", label: "Your Info" }, ...wizard, done];
  }
  return [...wizard, done];
}

type WizardState = {
  full_name: string;
  email: string;
  phone: string;
  pickup_date: string | null;
  return_date: string | null;
  city: string | null;
  source: string | null;
  // eligibility
  license_valid: boolean | null;
  gig_status: string | null;
  start_timing: string | null;
  // rental
  vehicle_size: string | null;
  rental_duration: string | null;
  // gig
  platforms: string[];
  profile_screenshot_url: string | null;
  // driver
  license_photo_url: string | null;
  full_coverage_insurance: boolean | null;
  address: string | null;
  state: string | null;
  zip: string | null;
  how_heard: string | null;
  current_step: WizardStep;
};

const GIG_OPTS = ["Yes, already driving", "Not yet, ready to start", "No"];
const START_OPTS = ["Today", "This week", "Within 2 weeks", "Just checking options"];
const VEHICLE_OPTS = ["Sedan", "SUV", "XL"];
const PLATFORM_OPTS = ["Uber", "Lyft", "DoorDash", "Uber Eats", "Instacart", "GrubHub", "Amazon Flex", "Other"];
const HOW_HEARD_OPTS = ["Facebook", "Instagram", "Referral", "Google", "Other"];

export function ApplicationWizard({ id }: { id: string }) {
  const navigate = useNavigate();
  const fetchApp = useServerFn(getApplicationForWizard);
  const updateStep = useServerFn(updateApplicationStep);
  const [state, setState] = useState<WizardState | null>(null);
  const [step, setStep] = useState<WizardStep>("eligibility");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchApp({ data: { id } })
      .then((row) => {
        setState({
          full_name: row.full_name ?? "",
          email: row.email ?? "",
          phone: row.phone ?? "",
          pickup_date: row.pickup_date,
          return_date: row.return_date,
          city: row.city,
          source: (row as any).source ?? null,
          license_valid: row.license_valid,
          gig_status: row.gig_status,
          start_timing: row.start_timing,
          vehicle_size: row.vehicle_size,
          rental_duration: row.rental_duration,
          platforms: row.platforms ?? [],
          profile_screenshot_url: row.profile_screenshot_url,
          license_photo_url: row.license_photo_url,
          full_coverage_insurance: row.full_coverage_insurance,
          address: row.address,
          state: row.state,
          zip: row.zip,
          how_heard: row.how_heard,
          current_step: (row.current_step as WizardStep) ?? "eligibility",
        });
        const next = (row.current_step as WizardStep) ?? "eligibility";
        setStep(next === "complete" ? "complete" : next);
      })
      .catch((e) => toast.error(e?.message ?? "Could not load your application."));
  }, [id]);

  if (!state) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const update = <K extends keyof WizardState>(k: K, v: WizardState[K]) =>
    setState((p) => (p ? { ...p, [k]: v } : p));

  const goNext = async (nextStep: WizardStep, payload: Partial<WizardState>) => {
    setSaving(true);
    try {
      await updateStep({
        data: {
          id,
          step: nextStep,
          ...payload,
        } as any,
      });
      setStep(nextStep);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    const idx = WIZARD_STEPS.indexOf(step as any);
    if (idx > 0) setStep(WIZARD_STEPS[idx - 1]);
  };

  return (
    <div className="max-w-2xl mx-auto w-full">
      <ProgressBar current={step} source={state.source} />
      <FadeUp delay={50}>
        <div className="mt-8 rounded-2xl bg-soft p-6 md:p-8">
          {step === "eligibility" && (
            <EligibilityStep source={state.source} state={state} update={update} onNext={() => goNext("rental", {
              license_valid: state.license_valid,
              gig_status: state.gig_status,
              start_timing: state.start_timing,
            })} saving={saving} />
          )}
          {step === "rental" && (
            <RentalStep source={state.source} state={state} update={update} onBack={goBack} onNext={() => goNext("gig", {
              vehicle_size: state.vehicle_size,
              pickup_date: state.pickup_date,
              return_date: state.return_date,
            })} saving={saving} />
          )}
          {step === "gig" && (
            <GigStep source={state.source} id={id} state={state} update={update} onBack={goBack} onNext={() => goNext("driver", {
              platforms: state.platforms,
              profile_screenshot_url: state.profile_screenshot_url,
            })} saving={saving} />
          )}
          {step === "driver" && (
            <DriverStep source={state.source} id={id} state={state} update={update} onBack={goBack} onSubmit={() => goNext("complete", {
              license_photo_url: state.license_photo_url,
              full_coverage_insurance: state.full_coverage_insurance,
              address: state.address,
              city: state.city,
              state: state.state,
              zip: state.zip,
              how_heard: state.how_heard,
            })} saving={saving} />
          )}
          {step === "complete" ? (
            <ConfirmationStep id={id} state={state} />
          ) : (
            <p className="mt-6 text-center text-[11px] text-muted-foreground">
              Takes about a minute — no payment required to submit.
            </p>
          )}
        </div>
      </FadeUp>
    </div>
  );
}

export function ProgressBar({
  current,
  source,
}: {
  current: WizardStep | "your_info";
  source: string | null | undefined;
}) {
  const segments = getBarSegments(source);
  const currentIdx = segments.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-1.5 md:gap-2">
      {segments.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.key} className="flex-1">
            <div className={`h-1.5 rounded-full transition-colors ${done || active ? "bg-real-red" : "bg-border"}`} />
            <div className={`mt-1.5 text-[10px] uppercase tracking-wider text-center ${active ? "text-real-red font-semibold" : "text-muted-foreground"}`}>
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function stepEyebrow(source: string | null | undefined, step: WizardStep) {
  // Wizard steps only (excludes "Your Info" and "Done").
  const segs = getBarSegments(source).filter((s) => s.key !== "complete" && s.key !== "your_info");
  const total = source === "homepage" ? segs.length + 1 : segs.length;
  const idx = segs.findIndex((s) => s.key === step);
  const num = source === "homepage" ? idx + 2 : idx + 1;
  return `Step ${num} Of ${total}`;
}

function StepHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <div className="text-[10px] uppercase tracking-[0.22em] font-semibold text-real-red">{eyebrow}</div>
      <h2 className="mt-2 text-2xl md:text-3xl font-semibold">{title}</h2>
      {sub && <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{sub}</p>}
    </div>
  );
}

function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value === o;
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className={`rounded-lg border px-4 py-2.5 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavRow({ onBack, onNext, saving, nextLabel = "Next", canNext = true }: { onBack?: () => void; onNext: () => void; saving: boolean; nextLabel?: string; canNext?: boolean }) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      {onBack ? (
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium text-foreground hover:border-foreground/40">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : <div />}
      <button type="button" onClick={onNext} disabled={saving || !canNext} className="inline-flex items-center gap-2 rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {nextLabel} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

type StepProps = {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  saving: boolean;
  source: string | null | undefined;
};

function EligibilityStep({ state, update, onNext, saving, source }: StepProps & { onNext: () => void }) {
  const canNext = state.license_valid !== null && !!state.gig_status && !!state.start_timing;
  return (
    <div>
      <StepHeader eyebrow={stepEyebrow(source, "eligibility")} title="Quick Eligibility" sub="A few quick questions so we can match you with the right vehicle." />
      <div className="space-y-6">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Do You Currently Hold A Valid Driver's License?</div>
          <div className="mt-2 flex gap-2">
            {[true, false].map((v) => {
              const active = state.license_valid === v;
              return (
                <button key={String(v)} type="button" onClick={() => update("license_valid", v)} className={`rounded-lg border px-5 py-2.5 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}>
                  {v ? "Yes" : "No"}
                </button>
              );
            })}
          </div>
        </div>
        <RadioGroup label="Are You Currently Driving Or Planning To Drive For Gig Apps?" value={state.gig_status as any} options={GIG_OPTS} onChange={(v) => update("gig_status", v)} />
        <RadioGroup label="How Soon Do You Want To Start?" value={state.start_timing as any} options={START_OPTS} onChange={(v) => update("start_timing", v)} />
      </div>
      <NavRow onNext={onNext} saving={saving} canNext={canNext} />
    </div>
  );
}

function RentalStep({ state, update, onBack, onNext, saving, source }: StepProps & { onBack: () => void; onNext: () => void }) {
  const canNext = !!state.vehicle_size && !!state.pickup_date && !!state.return_date && state.return_date > state.pickup_date;
  const today = new Date().toISOString().slice(0, 10);
  const days =
    state.pickup_date && state.return_date && state.return_date > state.pickup_date
      ? Math.round((new Date(state.return_date).getTime() - new Date(state.pickup_date).getTime()) / 86400000)
      : null;
  return (
    <div>
      <StepHeader eyebrow={stepEyebrow(source, "rental")} title="Rental Details" sub="Confirm what you need and when." />
      <div className="space-y-6">
        <RadioGroup label="Which Vehicle Size Are You Interested In?" value={state.vehicle_size as any} options={VEHICLE_OPTS} onChange={(v) => update("vehicle_size", v)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DateField label="Pick Up Date" min={today} value={state.pickup_date ?? ""} onChange={(v) => update("pickup_date", v)} />
          <DateField label="Return Date" min={state.pickup_date ?? today} value={state.return_date ?? ""} onChange={(v) => update("return_date", v)} />
        </div>
        {days !== null && (
          <div className="text-xs text-muted-foreground">
            Rental Length: <span className="font-semibold text-foreground">{days} {days === 1 ? "day" : "days"}</span>
          </div>
        )}
      </div>
      <NavRow onBack={onBack} onNext={onNext} saving={saving} canNext={canNext} />
    </div>
  );
}

function GigStep({ id, state, update, onBack, onNext, saving, source }: StepProps & { id: string; onBack: () => void; onNext: () => void }) {
  const canNext = state.platforms.length > 0;
  const toggle = (p: string) => {
    const next = state.platforms.includes(p) ? state.platforms.filter((x) => x !== p) : [...state.platforms, p];
    update("platforms", next);
  };
  return (
    <div>
      <StepHeader eyebrow={stepEyebrow(source, "gig")} title="Your Gig Profile" sub="Help us verify you're an active driver — this gets you to a hot lead status faster." />
      <div className="space-y-6">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">What Platforms Are You Currently Using?</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORM_OPTS.map((p) => {
              const active = state.platforms.includes(p);
              return (
                <button key={p} type="button" onClick={() => toggle(p)} className={`rounded-lg border px-4 py-2 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}>
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <FileUploadField
          label="Upload A Screenshot Of Your Profile (Trip Details + Ratings) — Optional"
          accept="image/*,application/pdf"
          bucket="profile-screenshots"
          applicationId={id}
          value={state.profile_screenshot_url}
          onChange={(v) => update("profile_screenshot_url", v)}
        />
      </div>
      <NavRow onBack={onBack} onNext={onNext} saving={saving} canNext={canNext} />
    </div>
  );
}

function DriverStep({ id, state, update, onBack, onSubmit, saving, source }: StepProps & { id: string; onBack: () => void; onSubmit: () => void }) {
  const canSubmit = !!state.address && !!state.state && !!state.zip && state.full_coverage_insurance !== null && !!state.how_heard;
  return (
    <div>
      <StepHeader eyebrow={stepEyebrow(source, "driver")} title="Driver & Insurance" sub="Last step. We need this for delivery + your rental records." />
      <div className="space-y-6">
        <FileUploadField
          label="Upload A Picture Of Your Driver's License — Optional, Helps Speed Approval"
          accept="image/*,application/pdf"
          bucket="license-uploads"
          applicationId={id}
          value={state.license_photo_url}
          onChange={(v) => update("license_photo_url", v)}
        />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Do You Have Full Coverage Insurance?</div>
          <div className="mt-2 flex gap-2">
            {[true, false].map((v) => {
              const active = state.full_coverage_insurance === v;
              return (
                <button key={String(v)} type="button" onClick={() => update("full_coverage_insurance", v)} className={`rounded-lg border px-5 py-2.5 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}>
                  {v ? "Yes" : "No"}
                </button>
              );
            })}
          </div>
        </div>
        <TextField label="Street Address" value={state.address ?? ""} onChange={(v) => update("address", v)} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <TextField label="City" value={state.city ?? ""} onChange={(v) => update("city", v)} />
          <TextField label="State" value={state.state ?? ""} onChange={(v) => update("state", v)} />
          <TextField label="ZIP" value={state.zip ?? ""} onChange={(v) => update("zip", v)} />
        </div>
        <RadioGroup label="How Did You Hear About Us?" value={state.how_heard as any} options={HOW_HEARD_OPTS} onChange={(v) => update("how_heard", v)} />
      </div>
      <NavRow onBack={onBack} onNext={onSubmit} saving={saving} canNext={canSubmit} nextLabel="Submit Application" />
    </div>
  );
}

function ConfirmationStep({ id, state }: { id: string; state: WizardState }) {
  const firstName = (state.full_name || "").trim().split(/\s+/)[0] || "there";
  const reference = `RR-${id.replace(/-/g, "").slice(-6).toUpperCase()}`;
  const email = "leads@drivereal.com";
  const dateRange =
    state.pickup_date && state.return_date
      ? `${fmtDate(state.pickup_date)} – ${fmtDate(state.return_date)}`
      : null;
  const chips = [
    state.city ? { icon: <CalendarCheck className="h-3.5 w-3.5" />, label: state.city } : null,
    state.vehicle_size ? { icon: <Car className="h-3.5 w-3.5" />, label: state.vehicle_size } : null,
    dateRange ? { icon: <CalendarCheck className="h-3.5 w-3.5" />, label: dateRange } : null,
  ].filter(Boolean) as { icon: React.ReactNode; label: string }[];

  const steps = [
    { title: "We'll Review & Call You", desc: "A team member will review your request and reach out shortly to confirm details." },
    { title: "Confirm Your Vehicle", desc: "We'll walk through availability and match you to the right vehicle for your needs." },
    { title: "Pick Up Or Delivery", desc: "Choose to pick up at our lot or have your vehicle delivered to you." },
  ];

  return (
    <div className="py-2">
      <div className="flex flex-col items-center text-center">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-[#FCEBEB] text-real-red">
          <Check className="h-8 w-8" strokeWidth={2.5} />
        </div>
        <h2 className="mt-6 text-2xl md:text-3xl font-semibold tracking-tight">Request Received — We'll Be In Touch</h2>
        <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-xl leading-snug">
          Thanks, {firstName}. A member of our team will review your request and call you shortly to confirm availability and your vehicle.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-1.5 text-xs">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">Reference</span>
          <span className="font-mono font-semibold text-foreground">#{reference}</span>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {chips.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-border px-3 py-1.5 text-xs text-foreground">
              {c.icon}
              {c.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-8">
        <div className="text-[10px] uppercase tracking-[0.22em] font-semibold text-muted-foreground mb-4 text-center">What Happens Next</div>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-4 rounded-xl bg-white border border-border p-4">
              <div className="flex-shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-full bg-real-red text-white text-sm font-semibold">
                {i + 1}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{s.title}</div>
                <div className="mt-0.5 text-sm text-muted-foreground leading-relaxed">{s.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 rounded-xl bg-white border border-border p-4">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Questions Now?</div>
        <a href={`mailto:${email}`} className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:text-real-red break-all">
          <Mail className="h-4 w-4 text-real-red" /> {email}
        </a>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a href={`mailto:${email}`} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white hover:opacity-90">
          <Mail className="h-4 w-4" /> Email Us
        </a>
        <Link to="/fleet" className="flex-1 inline-flex items-center justify-center rounded-lg border border-border bg-white px-6 py-3 text-sm font-medium hover:border-foreground/40">
          Browse Vehicles
        </Link>
      </div>

      <p className="mt-5 text-center text-[11px] text-muted-foreground">
        We typically respond within a few hours · No payment required.
      </p>
    </div>
  );
}

function fmtDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
      />
    </label>
  );
}

function DateField({ label, value, onChange, min }: { label: string; value: string; onChange: (v: string) => void; min?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <input
        type="date"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
      />
    </label>
  );
}

function FileUploadField({
  label,
  accept,
  bucket,
  applicationId,
  value,
  onChange,
}: {
  label: string;
  accept: string;
  bucket: string;
  applicationId: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const filename = useMemo(() => (value ? value.split("/").pop() : null), [value]);

  async function handleFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10MB.");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${applicationId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
      if (error) throw error;
      onChange(path);
      toast.success("Uploaded");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <label className="mt-2 flex items-center gap-3 rounded-lg border border-dashed border-border bg-white p-4 cursor-pointer hover:border-real-red/60">
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {uploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
        <div className="text-sm">
          {value ? <span className="text-foreground">Uploaded: <span className="text-muted-foreground">{filename}</span></span> : <span className="text-muted-foreground">Click to upload (PDF, DOC, or image, up to 10MB)</span>}
        </div>
      </label>
    </div>
  );
}