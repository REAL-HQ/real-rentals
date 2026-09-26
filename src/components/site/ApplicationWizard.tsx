import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Mail,
  Upload,
  Car,
  CalendarCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DocumentCapture } from "./DocumentCapture";
import { getApplicationForWizard, updateApplicationStep } from "@/lib/applications.functions";
import { FadeUp } from "./FadeUp";

type WizardStep = "eligibility" | "rental" | "gig" | "driver" | "complete";

const WIZARD_STEPS: WizardStep[] = ["eligibility", "rental", "gig", "driver"];
/**
 * The fields each step owns, so autosave writes exactly what is on screen.
 *
 * Deliberately the same lists the Next handlers send. A step must not autosave
 * a field it does not show — a half-filled later step would otherwise
 * overwrite good data with nulls.
 */
function fieldsFor(step: WizardStep, s: WizardState): Partial<WizardState> {
  switch (step) {
    case "eligibility":
      return {
        license_valid: s.license_valid,
        gig_status: s.gig_status,
        start_timing: s.start_timing,
      };
    case "rental":
      return {
        vehicle_size: s.vehicle_size,
        pickup_date: s.pickup_date,
        return_date: s.return_date,
      };
    case "gig":
      return {
        platforms: s.platforms,
        profile_screenshot_url: s.profile_screenshot_url,
        trips_completed: s.trips_completed,
        rating: s.rating,
        trip_screenshots: s.trip_screenshots,
      };
    case "driver":
      return {
        license_photo_url: s.license_photo_url,
        full_coverage_insurance: s.full_coverage_insurance,
        insurance_doc_url: s.insurance_doc_url,
        insurance_carrier: s.insurance_carrier,
        insurance_policy_number: s.insurance_policy_number,
        insurance_expires_on: s.insurance_expires_on,
        insurance_rideshare_endorsement: s.insurance_rideshare_endorsement,
        address: s.address,
        city: s.city,
        state: s.state,
        zip: s.zip,
        how_heard: s.how_heard,
      };
    default:
      return {};
  }
}

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
  trips_completed: string | null;
  rating: number | null;
  trip_screenshots: string[];
  // driver
  license_photo_url: string | null;
  full_coverage_insurance: boolean | null;
  insurance_doc_url: string | null;
  insurance_carrier: string | null;
  insurance_policy_number: string | null;
  insurance_expires_on: string | null;
  insurance_rideshare_endorsement: boolean | null;
  address: string | null;
  state: string | null;
  zip: string | null;
  how_heard: string | null;
  current_step: WizardStep;
};

const GIG_OPTS = ["Yes, already driving", "Not yet, ready to start", "No"];
const START_OPTS = ["Today", "This week", "Within 2 weeks", "Just checking options"];
const VEHICLE_OPTS = ["Sedan", "SUV", "XL"];
const PLATFORM_OPTS = [
  "Uber",
  "Lyft",
  "DoorDash",
  "Uber Eats",
  "Instacart",
  "GrubHub",
  "Amazon Flex",
  "Other",
];
const HOW_HEARD_OPTS = ["Facebook", "Instagram", "Referral", "Google", "Other"];

export function ApplicationWizard({ id }: { id: string }) {
  const navigate = useNavigate();
  const fetchApp = useServerFn(getApplicationForWizard);
  const updateStep = useServerFn(updateApplicationStep);
  const [state, setState] = useState<WizardState | null>(null);
  const [step, setStep] = useState<WizardStep>("eligibility");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Autosave.
  //
  // Answers used to live only in React state until the applicant pressed Next,
  // so closing the tab on the last question of a step threw the whole step
  // away. This writes a couple of seconds after typing stops. It saves the
  // fields, never the step: `current_step` still only moves when somebody
  // presses Next, so a half-finished step resumes where it was abandoned
  // rather than skipping ahead.
  const latest = useRef<WizardState | null>(null);
  const dirty = useRef(false);
  latest.current = state;

  const update = <K extends keyof WizardState>(k: K, v: WizardState[K]) => {
    dirty.current = true;
    setState((p) => (p ? { ...p, [k]: v } : p));
  };

  useEffect(() => {
    if (!state || !dirty.current) return;
    const t = setTimeout(async () => {
      const snapshot = latest.current;
      if (!snapshot || !dirty.current) return;
      dirty.current = false;
      try {
        await updateStep({ data: { id, step, ...fieldsFor(step, snapshot) } as never });
        setSavedAt(Date.now());
      } catch {
        // A failed autosave is not worth interrupting anybody over — the
        // explicit save on Next reports its own errors and is what counts.
        dirty.current = true;
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [state, step, id, updateStep]);

  useEffect(() => {
    fetchApp({ data: { id } })
      .then((row) => {
        setState({
          full_name: row.full_name ?? "",
          email: "",
          phone: "",
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
          trips_completed: (row as any).trips_completed ?? null,
          rating: (row as any).rating ?? null,
          trip_screenshots: ((row as any).trip_screenshots as string[] | null) ?? [],
          license_photo_url: row.license_photo_url,
          full_coverage_insurance: row.full_coverage_insurance,
          insurance_doc_url: (row as any).insurance_doc_url ?? null,
          insurance_carrier: row.insurance_carrier ?? null,
          insurance_policy_number: row.insurance_policy_number ?? null,
          insurance_expires_on: row.insurance_expires_on ?? null,
          insurance_rideshare_endorsement: row.insurance_rideshare_endorsement ?? null,
          // Street address and zip are PII and stay out of the public-by-id
          // read. An applicant who already gave them re-enters them here; the
          // alternative is handing them to anyone holding the link.
          address: null,
          state: row.state,
          zip: null,
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
      dirty.current = false;
      setSavedAt(Date.now());
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
    // Full-height two-panel layout rather than a card floating in a padded
    // page. With the site nav gone there is nothing above it, so the dark rail
    // runs the height of the screen and reads as the frame of the flow instead
    // of a widget sitting inside one.
    <div className="min-h-screen w-full">
      <div className="grid lg:grid-cols-[320px_1fr] lg:min-h-screen bg-soft">
        <SideRail current={step} source={state.source} />
        <FadeUp delay={50}>
          <div className="p-5 md:p-8">
            {/* The side rail is desktop-only, so on mobile it would otherwise
              carry no branding at all once the site nav was removed. One mark,
              either way — never both on screen at once. */}
            <div className="lg:hidden mb-6">
              <div className="inline-flex items-center gap-2 mb-5">
                <span className="inline-flex items-center justify-center h-7 px-2.5 rounded bg-real-red text-white text-[10px] font-black tracking-[0.18em]">
                  REAL
                </span>
                <span className="text-[10px] tracking-[0.3em] font-semibold text-muted-foreground">
                  RENTALS
                </span>
              </div>
              <ProgressBar current={step} source={state.source} />
              <SavedIndicator savedAt={savedAt} saving={saving} />
            </div>
            {step === "eligibility" && (
              <EligibilityStep
                source={state.source}
                state={state}
                update={update}
                onNext={() =>
                  goNext("rental", {
                    license_valid: state.license_valid,
                    gig_status: state.gig_status,
                    start_timing: state.start_timing,
                  })
                }
                saving={saving}
              />
            )}
            {step === "rental" && (
              <RentalStep
                source={state.source}
                state={state}
                update={update}
                onBack={goBack}
                onNext={() =>
                  goNext("gig", {
                    vehicle_size: state.vehicle_size,
                    pickup_date: state.pickup_date,
                    return_date: state.return_date,
                  })
                }
                saving={saving}
              />
            )}
            {step === "gig" && (
              <GigStep
                source={state.source}
                id={id}
                state={state}
                update={update}
                onBack={goBack}
                onNext={() =>
                  goNext("driver", {
                    platforms: state.platforms,
                    profile_screenshot_url: state.profile_screenshot_url,
                    trips_completed: state.trips_completed,
                    rating: state.rating,
                    trip_screenshots: state.trip_screenshots,
                  })
                }
                saving={saving}
              />
            )}
            {step === "driver" && (
              <DriverStep
                source={state.source}
                id={id}
                state={state}
                update={update}
                onBack={goBack}
                onSubmit={() =>
                  goNext("complete", {
                    license_photo_url: state.license_photo_url,
                    full_coverage_insurance: state.full_coverage_insurance,
                    insurance_doc_url: state.insurance_doc_url,
                    insurance_carrier: state.insurance_carrier,
                    insurance_policy_number: state.insurance_policy_number,
                    insurance_expires_on: state.insurance_expires_on,
                    insurance_rideshare_endorsement: state.insurance_rideshare_endorsement,
                    address: state.address,
                    city: state.city,
                    state: state.state,
                    zip: state.zip,
                    how_heard: state.how_heard,
                  })
                }
                saving={saving}
              />
            )}
            {step === "complete" ? (
              <ConfirmationStep id={id} state={state} />
            ) : (
              <p className="mt-6 text-center text-[11px] text-muted-foreground lg:hidden">
                Takes about a minute — no payment required to submit.
              </p>
            )}
          </div>
        </FadeUp>
      </div>
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
            <div
              className={`h-1.5 rounded-full transition-colors ${done || active ? "bg-real-red" : "bg-border"}`}
            />
            <div
              className={`mt-1.5 text-[10px] uppercase tracking-wider text-center ${active ? "text-real-red font-semibold" : "text-muted-foreground"}`}
            >
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SideRail({ current, source }: { current: WizardStep; source: string | null | undefined }) {
  const segments = getBarSegments(source);
  const currentIdx = segments.findIndex((s) => s.key === current);
  return (
    <aside className="hidden lg:flex flex-col bg-[#141416] text-white p-8">
      <div>
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex items-center justify-center h-8 px-2.5 rounded bg-real-red text-[11px] font-black tracking-[0.18em]">
            REAL
          </span>
          <span className="text-[11px] tracking-[0.3em] font-semibold text-white/70">RENTALS</span>
        </div>
        <h2 className="mt-8 text-2xl font-semibold leading-snug">Your Quote Request Is In</h2>
        <p className="mt-3 text-sm text-white/60 leading-relaxed">
          We've saved your contact info — a few quick questions and we'll match you with the right
          vehicle.
        </p>
        <ol className="mt-10 space-y-1">
          {segments.map((s, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <li
                key={s.key}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${active ? "bg-white/10" : ""}`}
              >
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    done
                      ? "bg-real-red text-white"
                      : active
                        ? "border border-real-red text-real-red"
                        : "border border-white/20 text-white/40"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span
                  className={`text-sm ${active ? "font-semibold text-white" : done ? "text-white/80" : "text-white/40"}`}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-auto pt-10 text-[11px] text-white/40">
        Takes about a minute · No payment required to submit.
      </p>
    </aside>
  );
}

function stepEyebrow(source: string | null | undefined, step: WizardStep) {
  // Post-lead profile phase: always 4 wizard steps regardless of entry path.
  const idx = WIZARD_STEPS.indexOf(step);
  return `Profile Step ${idx + 1} Of ${WIZARD_STEPS.length}`;
}

function StepHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] uppercase tracking-[0.22em] font-semibold text-real-red">
        {eyebrow}
      </div>
      <h2 className="mt-1.5 text-xl md:text-2xl font-semibold">{title}</h2>
      {sub && <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{sub}</p>}
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
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
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

/**
 * "Saved" — so leaving the page does not feel like losing the work.
 *
 * It says Saved only after a write has actually returned. Claiming otherwise
 * would be worse than saying nothing, because an applicant who believes their
 * answers are safe will close the tab.
 */
function SavedIndicator({ savedAt, saving }: { savedAt: number | null; saving: boolean }) {
  if (saving) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </div>
    );
  }
  if (!savedAt) return null;
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} /> Saved automatically
    </div>
  );
}

function NavRow({
  onBack,
  onNext,
  saving,
  nextLabel = "Next",
  canNext = true,
}: {
  onBack?: () => void;
  onNext: () => void;
  saving: boolean;
  nextLabel?: string;
  canNext?: boolean;
}) {
  // Sticky on phones, inline on desktop.
  //
  // A long step used to scroll its own Submit button off the bottom of the
  // screen, so the applicant reached the end of the questions and found
  // nothing to press. The safe-area padding keeps it clear of the home
  // indicator on a modern iPhone.
  return (
    <div
      className="mt-6 sticky bottom-0 -mx-5 md:mx-0 md:static border-t border-border md:border-0 bg-white/95 backdrop-blur md:bg-transparent md:backdrop-blur-none px-5 md:px-0 pt-3 md:pt-0 flex items-center justify-between gap-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 min-h-[48px] text-sm font-medium text-foreground hover:border-foreground/40"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : (
        <div />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={saving || !canNext}
        className="inline-flex flex-1 md:flex-none items-center justify-center gap-2 rounded-lg bg-real-red px-6 min-h-[48px] text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
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

function EligibilityStep({
  state,
  update,
  onNext,
  saving,
  source,
}: StepProps & { onNext: () => void }) {
  const canNext = state.license_valid !== null && !!state.start_timing;
  return (
    <div>
      <StepHeader
        eyebrow={stepEyebrow(source, "eligibility")}
        title="Quick Eligibility"
        sub="A few quick questions so we can match you with the right vehicle."
      />
      <div className="space-y-5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Do You Currently Hold A Valid Driver's License?
          </div>
          <div className="mt-2 flex gap-2">
            {[true, false].map((v) => {
              const active = state.license_valid === v;
              return (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => update("license_valid", v)}
                  className={`rounded-lg border px-5 py-2.5 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
                >
                  {v ? "Yes" : "No"}
                </button>
              );
            })}
          </div>
        </div>
        <RadioGroup
          label="How Soon Do You Want To Start?"
          value={state.start_timing as any}
          options={START_OPTS}
          onChange={(v) => update("start_timing", v)}
        />
      </div>
      <NavRow onNext={onNext} saving={saving} canNext={canNext} />
    </div>
  );
}

function RentalStep({
  state,
  update,
  onBack,
  onNext,
  saving,
  source,
}: StepProps & { onBack: () => void; onNext: () => void }) {
  const canNext =
    !!state.vehicle_size &&
    !!state.pickup_date &&
    !!state.return_date &&
    state.return_date > state.pickup_date;
  const today = new Date().toISOString().slice(0, 10);
  const days =
    state.pickup_date && state.return_date && state.return_date > state.pickup_date
      ? Math.round(
          (new Date(state.return_date).getTime() - new Date(state.pickup_date).getTime()) /
            86400000,
        )
      : null;
  return (
    <div>
      <StepHeader
        eyebrow={stepEyebrow(source, "rental")}
        title="Rental Details"
        sub="Confirm what you need and when."
      />
      <div className="space-y-5">
        <RadioGroup
          label="Which Vehicle Size Are You Interested In?"
          value={state.vehicle_size as any}
          options={VEHICLE_OPTS}
          onChange={(v) => update("vehicle_size", v)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DateField
            label="Pick Up Date"
            min={today}
            value={state.pickup_date ?? ""}
            onChange={(v) => update("pickup_date", v)}
          />
          <DateField
            label="Return Date"
            min={state.pickup_date ?? today}
            value={state.return_date ?? ""}
            onChange={(v) => update("return_date", v)}
          />
        </div>
        {days !== null && (
          <div className="text-xs text-muted-foreground">
            Rental Length:{" "}
            <span className="font-semibold text-foreground">
              {days} {days === 1 ? "day" : "days"}
            </span>
          </div>
        )}
      </div>
      <NavRow onBack={onBack} onNext={onNext} saving={saving} canNext={canNext} />
    </div>
  );
}

function GigStep({
  id,
  state,
  update,
  onBack,
  onNext,
  saving,
  source,
}: StepProps & { id: string; onBack: () => void; onNext: () => void }) {
  const trips = Number(state.trips_completed);
  const tripsOk = !Number.isNaN(trips) && trips >= 200;
  const canNext = state.platforms.length > 0 && tripsOk && state.trip_screenshots.length > 0;
  const toggle = (p: string) => {
    const next = state.platforms.includes(p)
      ? state.platforms.filter((x) => x !== p)
      : [...state.platforms, p];
    update("platforms", next);
  };
  return (
    <div>
      <StepHeader
        eyebrow={stepEyebrow(source, "gig")}
        title="Your Gig Profile"
        sub="We work with active drivers who've completed 200+ trips or deliveries on any app. Please share your totals and upload a screenshot showing your lifetime trip/delivery count."
      />
      <div className="space-y-5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            What Platforms Are You Currently Using?
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORM_OPTS.map((p) => {
              const active = state.platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(p)}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Total Trips / Deliveries Completed <span className="text-real-red">*</span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="e.g. 850"
              value={state.trips_completed ?? ""}
              onChange={(e) => update("trips_completed", e.target.value || null)}
              className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
            />
            <span
              className={`mt-1 block text-[11px] ${tripsOk ? "text-emerald-600" : "text-muted-foreground"}`}
            >
              200+ required · combined across all apps
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Driver Rating
            </span>
            <input
              type="number"
              step="0.01"
              min={1}
              max={5}
              placeholder="e.g. 4.92"
              value={state.rating ?? ""}
              onChange={(e) =>
                update("rating", e.target.value === "" ? null : Number(e.target.value))
              }
              className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
            />
          </label>
        </div>
        <MultiFileUploadField
          label="Upload Screenshots Of Your Trip / Delivery Totals (Required)"
          hint="Upload a screenshot showing your lifetime trips or deliveries from any app (Uber, Lyft, DoorDash, Instacart, Shipt, etc.). One per app is best."
          accept="image/*,application/pdf"
          bucket="profile-screenshots"
          applicationId={id}
          values={state.trip_screenshots}
          onChange={(v) => {
            update("trip_screenshots", v);
            // Keep the legacy single field in sync so admin views that only read it still work.
            update("profile_screenshot_url", v[0] ?? null);
          }}
        />
      </div>
      <NavRow onBack={onBack} onNext={onNext} saving={saving} canNext={canNext} />
    </div>
  );
}

function DriverStep({
  id,
  state,
  update,
  onBack,
  onSubmit,
  saving,
  source,
}: StepProps & { id: string; onBack: () => void; onSubmit: () => void }) {
  const canSubmit =
    !!state.address &&
    !!state.state &&
    !!state.zip &&
    state.full_coverage_insurance !== null &&
    !!state.how_heard;
  return (
    <div>
      <StepHeader
        eyebrow={stepEyebrow(source, "driver")}
        title="Driver & Insurance"
        sub="Last step. We need this for delivery + your rental records."
      />
      <div className="space-y-5">
        <DocumentCapture
          title="Driver's licence"
          hint="Take a photo of the front of your licence."
          tips={[
            "All four corners in the frame",
            "No glare across the text",
            "Close enough to read your name and the expiry date",
          ]}
          bucket="license-uploads"
          applicationId={id}
          value={state.license_photo_url}
          onChange={(v) => update("license_photo_url", v)}
          optional
        />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Do You Have Full Coverage Insurance?
          </div>
          <div className="mt-2 flex gap-2">
            {[true, false].map((v) => {
              const active = state.full_coverage_insurance === v;
              return (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => update("full_coverage_insurance", v)}
                  className={`rounded-lg border px-5 py-2.5 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
                >
                  {v ? "Yes" : "No"}
                </button>
              );
            })}
          </div>
        </div>
        {state.full_coverage_insurance === true && (
          <div className="space-y-4 rounded-xl border border-border bg-white p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField
                label="Insurance Carrier"
                value={state.insurance_carrier ?? ""}
                onChange={(v) => update("insurance_carrier", v)}
              />
              <TextField
                label="Policy Number"
                value={state.insurance_policy_number ?? ""}
                onChange={(v) => update("insurance_policy_number", v)}
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Policy Expiration Date
              </div>
              <input
                type="date"
                value={state.insurance_expires_on ?? ""}
                onChange={(e) => update("insurance_expires_on", e.target.value || null)}
                className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Does Your Policy Include A Rideshare Endorsement?
              </div>
              <div className="mt-2 flex gap-2">
                {[true, false].map((v) => {
                  const active = state.insurance_rideshare_endorsement === v;
                  return (
                    <button
                      key={String(v)}
                      type="button"
                      onClick={() => update("insurance_rideshare_endorsement", v)}
                      className={`rounded-lg border px-5 py-2.5 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
                    >
                      {v ? "Yes" : "Not sure"}
                    </button>
                  );
                })}
              </div>
            </div>
            <DocumentCapture
              title="Insurance card"
              hint="Photograph your insurance card or declaration page."
              tips={["Show the policy number and the dates it covers"]}
              bucket="license-uploads"
              applicationId={id}
              value={state.insurance_doc_url}
              onChange={(v) => update("insurance_doc_url", v)}
              optional
            />
          </div>
        )}
        {state.full_coverage_insurance === false && (
          <div className="rounded-xl border border-border bg-soft p-4 text-sm text-muted-foreground">
            No problem — coverage is not required to apply. Our team will walk you through the
            options that work for your situation when we call.
          </div>
        )}
        <TextField
          label="Street Address"
          value={state.address ?? ""}
          onChange={(v) => update("address", v)}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <TextField label="City" value={state.city ?? ""} onChange={(v) => update("city", v)} />
          <TextField label="State" value={state.state ?? ""} onChange={(v) => update("state", v)} />
          <TextField label="ZIP" value={state.zip ?? ""} onChange={(v) => update("zip", v)} />
        </div>
        <RadioGroup
          label="How Did You Hear About Us?"
          value={state.how_heard as any}
          options={HOW_HEARD_OPTS}
          onChange={(v) => update("how_heard", v)}
        />
      </div>
      <NavRow
        onBack={onBack}
        onNext={onSubmit}
        saving={saving}
        canNext={canSubmit}
        nextLabel="Submit Application"
      />
    </div>
  );
}

function ConfirmationStep({ id, state }: { id: string; state: WizardState }) {
  const firstName = (state.full_name || "").trim().split(/\s+/)[0] || "there";
  const reference = `RR-${id.replace(/-/g, "").slice(-6).toUpperCase()}`;
  const email = "team@drivereal.com";
  const dateRange =
    state.pickup_date && state.return_date
      ? `${fmtDate(state.pickup_date)} – ${fmtDate(state.return_date)}`
      : null;
  const chips = [
    state.city ? { icon: <CalendarCheck className="h-3.5 w-3.5" />, label: state.city } : null,
    state.vehicle_size
      ? { icon: <Car className="h-3.5 w-3.5" />, label: state.vehicle_size }
      : null,
    dateRange ? { icon: <CalendarCheck className="h-3.5 w-3.5" />, label: dateRange } : null,
  ].filter(Boolean) as { icon: React.ReactNode; label: string }[];

  const steps = [
    {
      title: "We'll Review & Call You",
      desc: "A team member will review your request and reach out shortly to confirm details.",
    },
    {
      title: "Confirm Your Vehicle",
      desc: "We'll walk through availability and match you to the right vehicle for your needs.",
    },
    {
      title: "Pick Up Or Delivery",
      desc: "Choose to pick up at our lot or have your vehicle delivered to you.",
    },
  ];

  return (
    <div className="py-2">
      <div className="flex flex-col items-center text-center">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-[#FCEBEB] text-real-red">
          <Check className="h-8 w-8" strokeWidth={2.5} />
        </div>
        <h2 className="mt-6 text-2xl md:text-3xl font-semibold tracking-tight">
          Request Received — We'll Be In Touch
        </h2>
        <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-xl leading-snug">
          Thanks, {firstName}. A member of our team will review your request and call you shortly to
          confirm availability and your vehicle.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-1.5 text-xs">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
            Reference
          </span>
          <span className="font-mono font-semibold text-foreground">#{reference}</span>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {chips.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-white border border-border px-3 py-1.5 text-xs text-foreground"
            >
              {c.icon}
              {c.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-8">
        <div className="text-[10px] uppercase tracking-[0.22em] font-semibold text-muted-foreground mb-4 text-center">
          What Happens Next
        </div>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-4 rounded-xl bg-white border border-border p-4"
            >
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
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
          Questions Now?
        </div>
        <a
          href={`mailto:${email}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:text-real-red break-all"
        >
          <Mail className="h-4 w-4 text-real-red" /> {email}
        </a>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a
          href={`mailto:${email}`}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
        >
          <Mail className="h-4 w-4" /> Email Us
        </a>
        <Link
          to="/fleet"
          className="flex-1 inline-flex items-center justify-center rounded-lg border border-border bg-white px-6 py-3 text-sm font-medium hover:border-foreground/40"
        >
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

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
      />
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
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

function extFromMime(mime: string): string {
  switch ((mime || "").toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/heic":
    case "image/heif":
      return "heic";
    case "application/pdf":
      return "pdf";
    default:
      return "jpg";
  }
}

function MultiFileUploadField({
  label,
  hint,
  accept,
  bucket,
  applicationId,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  accept: string;
  bucket: string;
  applicationId: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList) {
    setUploading(true);
    const uploaded: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name}: file must be under 10MB.`);
          continue;
        }
        const ext = extFromMime(file.type);
        const path = `${applicationId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (error) {
          console.error("[upload] failed", error);
          toast.error(
            "We couldn't upload that file. Please try again — or email it to team@drivereal.com and we'll attach it for you.",
          );
          continue;
        }
        uploaded.push(path);
      }
      if (uploaded.length) {
        onChange([...values, ...uploaded].slice(0, 10));
        toast.success(`Uploaded ${uploaded.length}`);
      }
    } finally {
      setUploading(false);
    }
  }

  function remove(path: string) {
    onChange(values.filter((v) => v !== path));
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label} <span className="text-real-red">*</span>
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      <label className="mt-2 flex items-center gap-3 rounded-lg border border-dashed border-border bg-white p-3 cursor-pointer hover:border-real-red/60">
        <input
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground" />
        )}
        <div className="text-sm text-muted-foreground">
          Click to upload one or more files (PDF or image, up to 10MB each)
        </div>
      </label>
      {values.length > 0 && (
        <ul className="mt-3 space-y-2">
          {values.map((path) => (
            <li
              key={path}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-white px-3 py-2 text-sm"
            >
              <span className="truncate text-muted-foreground">{path.split("/").pop()}</span>
              <button
                type="button"
                onClick={() => remove(path)}
                className="text-[11px] font-semibold text-real-red hover:underline shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
