import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Check, Loader2, Phone, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getApplicationForWizard, updateApplicationStep } from "@/lib/applications.functions";
import { FadeUp } from "./FadeUp";

type WizardStep = "eligibility" | "rental" | "gig" | "driver" | "complete";

const STEP_ORDER: WizardStep[] = ["eligibility", "rental", "gig", "driver", "complete"];
const STEP_LABELS: Record<WizardStep, string> = {
  eligibility: "Eligibility",
  rental: "Rental",
  gig: "Profile",
  driver: "Driver",
  complete: "Done",
};

type WizardState = {
  full_name: string;
  email: string;
  phone: string;
  pickup_date: string | null;
  return_date: string | null;
  city: string | null;
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
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  };

  return (
    <div className="max-w-2xl mx-auto w-full">
      <ProgressBar current={step} />
      <FadeUp delay={50}>
        <div className="mt-8 rounded-2xl bg-soft p-6 md:p-8">
          {step === "eligibility" && (
            <EligibilityStep state={state} update={update} onNext={() => goNext("rental", {
              license_valid: state.license_valid,
              gig_status: state.gig_status,
              start_timing: state.start_timing,
            })} saving={saving} />
          )}
          {step === "rental" && (
            <RentalStep state={state} update={update} onBack={goBack} onNext={() => goNext("gig", {
              vehicle_size: state.vehicle_size,
              pickup_date: state.pickup_date,
              return_date: state.return_date,
            })} saving={saving} />
          )}
          {step === "gig" && (
            <GigStep id={id} state={state} update={update} onBack={goBack} onNext={() => goNext("driver", {
              platforms: state.platforms,
              profile_screenshot_url: state.profile_screenshot_url,
            })} saving={saving} />
          )}
          {step === "driver" && (
            <DriverStep id={id} state={state} update={update} onBack={goBack} onSubmit={() => goNext("complete", {
              license_photo_url: state.license_photo_url,
              full_coverage_insurance: state.full_coverage_insurance,
              address: state.address,
              city: state.city,
              state: state.state,
              zip: state.zip,
              how_heard: state.how_heard,
            })} saving={saving} />
          )}
          {step === "complete" && <ConfirmationStep />}
          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            Takes about a minute — no payment required to submit.
          </p>
        </div>
      </FadeUp>
    </div>
  );
}

function ProgressBar({ current }: { current: WizardStep }) {
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <div className="flex items-center gap-1.5 md:gap-2">
      {STEP_ORDER.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s} className="flex-1">
            <div className={`h-1.5 rounded-full transition-colors ${done || active ? "bg-real-red" : "bg-border"}`} />
            <div className={`mt-1.5 text-[10px] uppercase tracking-wider text-center ${active ? "text-real-red font-semibold" : "text-muted-foreground"}`}>
              {STEP_LABELS[s]}
            </div>
          </div>
        );
      })}
    </div>
  );
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
};

function EligibilityStep({ state, update, onNext, saving }: StepProps & { onNext: () => void }) {
  const canNext = state.license_valid !== null && !!state.gig_status && !!state.start_timing;
  return (
    <div>
      <StepHeader eyebrow="Step 1 of 4" title="Quick Eligibility" sub="A few quick questions so we can match you with the right vehicle." />
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

function RentalStep({ state, update, onBack, onNext, saving }: StepProps & { onBack: () => void; onNext: () => void }) {
  const canNext = !!state.vehicle_size && !!state.pickup_date && !!state.return_date && state.return_date > state.pickup_date;
  const today = new Date().toISOString().slice(0, 10);
  const days =
    state.pickup_date && state.return_date && state.return_date > state.pickup_date
      ? Math.round((new Date(state.return_date).getTime() - new Date(state.pickup_date).getTime()) / 86400000)
      : null;
  return (
    <div>
      <StepHeader eyebrow="Step 2 of 4" title="Rental Details" sub="Confirm what you need and when." />
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

function GigStep({ id, state, update, onBack, onNext, saving }: StepProps & { id: string; onBack: () => void; onNext: () => void }) {
  const canNext = state.platforms.length > 0;
  const toggle = (p: string) => {
    const next = state.platforms.includes(p) ? state.platforms.filter((x) => x !== p) : [...state.platforms, p];
    update("platforms", next);
  };
  return (
    <div>
      <StepHeader eyebrow="Step 3 of 4" title="Your Gig Profile" sub="Help us verify you're an active driver — this gets you to a hot lead status faster." />
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

function DriverStep({ id, state, update, onBack, onSubmit, saving }: StepProps & { id: string; onBack: () => void; onSubmit: () => void }) {
  const canSubmit = !!state.address && !!state.state && !!state.zip && state.full_coverage_insurance !== null && !!state.how_heard;
  return (
    <div>
      <StepHeader eyebrow="Step 4 of 4" title="Driver & Insurance" sub="Last step. We need this for delivery + your rental records." />
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

function ConfirmationStep() {
  return (
    <div className="text-center py-6">
      <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-real-red/10 text-real-red">
        <Check className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-2xl md:text-3xl font-semibold">Application Received — You Qualify For A Premium Rental.</h2>
      <p className="mt-4 text-sm text-muted-foreground">Next steps:</p>
      <ol className="mt-3 inline-block text-left text-sm space-y-1">
        <li>1) We'll call you shortly</li>
        <li>2) Choose your vehicle</li>
        <li>3) Vehicle delivery</li>
      </ol>
      <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
        <a href="tel:+18888888888" className="inline-flex items-center justify-center gap-2 rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white hover:opacity-90">
          <Phone className="h-4 w-4" /> Call Now
        </a>
        <Link to="/fleet" className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-6 py-3 text-sm font-medium hover:border-foreground/40">
          Browse Vehicles
        </Link>
      </div>
    </div>
  );
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