import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Loader2,
  Mail,
  Upload,
  Car,
  CalendarCheck,
  ChevronRight,
  ShieldCheck,
  IdCard,
  Smartphone,
  MapPin,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { DocumentCapture } from "./DocumentCapture";
import { Logo } from "./Logo";
import { getApplicationForWizard, updateApplicationStep } from "@/lib/applications.functions";
import { uploadApplicantFile, UploadTooLarge } from "@/lib/applicant-upload";
import { clearResumeToken } from "@/lib/resume-token";
import { FadeUp } from "./FadeUp";

/*
 * ONE application, TWO parts.
 *
 * Part 1 — Quick Application is everything we need to pick the phone up and
 * call somebody: what they want to drive, when, for roughly how long, and what
 * their gig work looks like. Nine questions, no documents, no address, no
 * eligibility gate. Submitting it is the conversion: the application is real,
 * staff see it, readiness evaluates it.
 *
 * Part 2 — Complete Your Driver Profile is the paperwork: licence, insurance,
 * gig screenshots, trip history, address. It is optional, resumable, and its
 * absence means "not finished yet", never "abandoned".
 *
 * There is one application row, one document vault and one wizard. Part 2 is a
 * later phase of this component, not a second system.
 */

type Phase = "rental" | "driving" | "submitted" | "documents" | "profile_complete";

const PART1_STEPS: Phase[] = ["rental", "driving"];

const PHASES: readonly Phase[] = [
  "rental",
  "driving",
  "submitted",
  "documents",
  "profile_complete",
];

/**
 * Where an application written by the old wizard picks up.
 *
 * The step names changed with the Part 1 / Part 2 split, and the column is
 * full of the old ones — every partial application in production sits on
 * `eligibility`. Casting the column straight to Phase rendered none of the
 * five branches: the applicant clicked the link in a recovery email and got a
 * logo and an empty page. Anything unrecognised starts at the beginning,
 * which is safe because every answer is prefilled from the row.
 */
const LEGACY_PHASES: Record<string, Phase> = {
  eligibility: "rental",
  rental: "rental",
  gig: "driving",
  driver: "driving",
  // Real historical values too — they appear in application-stage.ts and the
  // old scoring prompt. They sat after the gig step, so they resume there
  // rather than restarting at question one.
  vehicle: "driving",
  review: "submitted",
  complete: "submitted",
  confirmation: "submitted",
  done: "submitted",
};

function phaseFrom(stored: unknown): Phase {
  const raw = typeof stored === "string" ? stored.trim().toLowerCase() : "";
  if ((PHASES as readonly string[]).includes(raw)) return raw as Phase;
  return LEGACY_PHASES[raw] ?? "rental";
}

/**
 * The fields each step owns, so autosave writes exactly what is on screen.
 *
 * A step must not autosave a field it does not show — a half-filled later step
 * would otherwise overwrite good data with nulls.
 */
function fieldsFor(phase: Phase, s: WizardState): Record<string, unknown> {
  switch (phase) {
    case "rental":
      return {
        vehicle_size: s.vehicle_size,
        pickup_date: s.pickup_date,
        expected_duration: s.expected_duration,
        city: s.city,
        state: s.state,
      };
    case "driving":
      return {
        platforms: s.platforms,
        gig_status: s.gig_status,
        trips_completed: s.trips_completed,
        rating: s.rating,
        drive_type: s.drive_type,
        insurance_answer: s.insurance_answer,
      };
    default:
      return {};
  }
}

// ---------------------------------------------------------------- vocabulary

const VEHICLE_OPTS = ["Sedan", "SUV", "XL"] as const;

/**
 * Duration bands, not a return date.
 *
 * An applicant filling this in has not been quoted a rate and has not seen a
 * car. Asking them for an exact return date produced a contractual-looking
 * value that was really a guess, and it then flowed into the rental agreement.
 * The stored values are new; applications.return_date keeps its history and is
 * never reinterpreted as one of these.
 */
const DURATION_OPTS = [
  // Months, because that is how these rentals actually run. Deliberately not
  // phrased as a minimum anywhere an applicant can see: somebody who needs a
  // car for three weeks still applies, and the team decides. The old
  // week-scale values stay readable on historical applications — see
  // DURATION_LABEL in DriversPanel — they are just no longer offered.
  { value: "1_month", label: "1 Month" },
  { value: "2_months", label: "2 Months" },
  { value: "3_months", label: "3 Months" },
  { value: "4plus_months", label: "4+ Months" },
  { value: "not_sure", label: "Not Sure Yet" },
] as const;

/**
 * Stored verbatim, because the readiness model already understands these exact
 * strings. Only the question above them changed.
 */
const GIG_STATUS_OPTS = [
  { value: "Yes, already driving", label: "Yes, Already Driving" },
  { value: "Not yet, ready to start", label: "Not Yet — Ready To Start" },
  { value: "No", label: "No" },
] as const;

const DRIVE_TYPE_OPTS = [
  { value: "full_time", label: "Full-Time" },
  { value: "part_time", label: "Part-Time" },
] as const;

const INSURANCE_OPTS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not Sure" },
] as const;

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

type WizardState = {
  full_name: string;
  city: string | null;
  state: string | null;
  source: string | null;
  // Part 1
  vehicle_size: string | null;
  pickup_date: string | null;
  expected_duration: string | null;
  platforms: string[];
  gig_status: string | null;
  trips_completed: string | null;
  rating: number | null;
  drive_type: string | null;
  insurance_answer: string | null;
  // Part 2
  license_valid: boolean | null;
  insurance_carrier: string | null;
  insurance_expires_on: string | null;
  insurance_rideshare_endorsement: boolean | null;
  address: string | null;
  zip: string | null;

  /*
   * Documents are tracked as presence, not paths.
   *
   * The server no longer returns storage paths to a resume-token bearer — a
   * path plus a bucket is the shape of an object, and a resume link is a
   * bearer credential that travels by email. The wizard only ever used the
   * path for truthiness anyway; the preview it shows is a local object URL of
   * the file the applicant just picked.
   *
   * `*_on_file` is what the server said. `*_added` is a path from an upload in
   * this session, which is the one case the browser legitimately holds one.
   */
  license_photo_on_file: boolean;
  insurance_doc_on_file: boolean;
  profile_screenshot_on_file: boolean;
  /** Display names of the stored screenshots, in stored order. */
  trip_screenshot_names: string[];
  /** Filenames of the stored screenshots the applicant still wants. */
  trip_screenshots_keep: string[];
  /** Storage paths uploaded during this session only. */
  trip_screenshots_added: string[];

  /** The policy number is never returned in full; this is the last four. */
  insurance_policy_on_file: boolean;
  insurance_policy_last4: string | null;
  /** Set only when the applicant chooses to replace it. */
  insurance_policy_number: string | null;
};

// ------------------------------------------------------------- progress bar

const PHASE_LABELS: Record<string, string> = {
  your_info: "Your Info",
  rental: "Rental",
  driving: "Driving",
  submitted: "Done",
};

/**
 * Progress segments, driven by entry path. Homepage users completed the
 * contact step in /apply before the wizard mounted, so it is the first
 * segment. City-page users gave their contact details in the hero form.
 */
export function getBarSegments(source: string | null | undefined): {
  key: string;
  label: string;
}[] {
  const core = [...PART1_STEPS, "submitted"].map((k) => ({ key: k, label: PHASE_LABELS[k] }));
  if (source === "homepage") return [{ key: "your_info", label: "Your Info" }, ...core];
  return core;
}

export function ProgressBar({
  current,
  source,
}: {
  current: string;
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

// ------------------------------------------------------------------ wizard

export function ApplicationWizard({ token }: { token: string }) {
  const fetchApp = useServerFn(getApplicationForWizard);
  const updateStep = useServerFn(updateApplicationStep);
  const [state, setState] = useState<WizardState | null>(null);
  const [phase, setPhase] = useState<Phase>("rental");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Autosave. Answers used to live only in React state until the applicant
  // pressed Next, so closing the tab on the last question of a step threw the
  // whole step away. This writes a couple of seconds after typing stops, and
  // saves fields only — the phase moves when somebody presses a button.
  const latest = useRef<WizardState | null>(null);
  const dirty = useRef(false);
  latest.current = state;

  const update = <K extends keyof WizardState>(k: K, v: WizardState[K]) => {
    dirty.current = true;
    setState((p) => (p ? { ...p, [k]: v } : p));
  };

  useEffect(() => {
    if (!state || !dirty.current) return;
    if (phase !== "rental" && phase !== "driving") return;
    const t = setTimeout(async () => {
      const snapshot = latest.current;
      if (!snapshot || !dirty.current) return;
      dirty.current = false;
      try {
        await updateStep({ data: { token, step: phase, ...fieldsFor(phase, snapshot) } as never });
        setSavedAt(Date.now());
      } catch {
        // A failed autosave is not worth interrupting anybody over — the
        // explicit save on Next reports its own errors and is what counts.
        dirty.current = true;
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [state, phase, token, updateStep]);

  useEffect(() => {
    fetchApp({ data: { token } })
      .then((row) => {
        setState({
          full_name: row.full_name ?? "",
          city: row.city,
          state: row.state,
          source: (row as { source?: string | null }).source ?? null,
          vehicle_size: row.vehicle_size,
          pickup_date: row.pickup_date,
          expected_duration: row.expected_duration,
          platforms: row.platforms ?? [],
          gig_status: row.gig_status,
          trips_completed: row.trips_completed ?? null,
          rating: row.rating ?? null,
          drive_type: row.drive_type,
          insurance_answer: row.insurance_answer,
          license_valid: row.license_valid,
          insurance_carrier: row.insurance_carrier ?? null,
          insurance_expires_on: row.insurance_expires_on ?? null,
          insurance_rideshare_endorsement: row.insurance_rideshare_endorsement ?? null,
          address: row.address,
          zip: row.zip,
          license_photo_on_file: row.license_photo_on_file,
          insurance_doc_on_file: row.insurance_doc_on_file,
          profile_screenshot_on_file: row.profile_screenshot_on_file,
          trip_screenshot_names: row.trip_screenshot_names,
          trip_screenshots_keep: [...row.trip_screenshot_names],
          trip_screenshots_added: [],
          insurance_policy_on_file: row.insurance_policy_on_file,
          insurance_policy_last4: row.insurance_policy_last4,
          insurance_policy_number: null,
        });
        setPhase(phaseFrom(row.current_step));
      })
      .catch((e) => setLoadError(e?.message ?? "Could not load your application."));
  }, [token, fetchApp]);

  if (loadError) return <LinkExpired message={loadError} />;

  if (!state) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const go = async (next: Phase, payload: Record<string, unknown>) => {
    // Stand the autosave down before the explicit write, not after it. The
    // debounced timer used to be cancelled only when setPhase re-ran the
    // effect, which happens after the await — so on a slow connection a stale
    // step:"rental" write could land behind step:"submitted" and rewind
    // current_step, which in turn made the recovery cron think this applicant
    // had not finished and email them to say so.
    dirty.current = false;
    setSaving(true);
    try {
      await updateStep({ data: { token, step: next, ...payload } as never });
      dirty.current = false;
      setSavedAt(Date.now());
      setPhase(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inPart1 = phase === "rental" || phase === "driving";

  return (
    <div className="min-h-screen w-full">
      {/* grid-cols-1 is load-bearing, not tidiness. Without it the single
          mobile track is `auto`, which sizes to the widest child's content —
          Part 2's section rows have a long no-wrap blurb — and the whole page
          scrolled sideways at 375px. min-w-0 stops the track from being
          widened by an overflowing descendant. */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] lg:min-h-screen bg-soft min-w-0">
        <SideRail phase={phase} source={state.source} />
        <FadeUp delay={50} className="min-w-0">
          <div className="p-5 md:p-8 min-w-0">
            {/* The side rail is desktop-only, so on mobile it would otherwise
              carry no branding at all once the site nav was removed. One mark,
              either way — never both on screen at once. */}
            <div className="lg:hidden mb-6">
              <div className="mb-5">
                <Logo width={84} offset={false} href={false} />
              </div>
              {inPart1 && (
                <>
                  <ProgressBar current={phase} source={state.source} />
                  <SavedIndicator savedAt={savedAt} saving={saving} />
                </>
              )}
            </div>

            {phase === "rental" && (
              <RentalStep
                state={state}
                update={update}
                saving={saving}
                onNext={() => go("driving", fieldsFor("rental", state))}
              />
            )}
            {phase === "driving" && (
              <DrivingStep
                state={state}
                update={update}
                saving={saving}
                onBack={() => setPhase("rental")}
                onSubmit={() => go("submitted", fieldsFor("driving", state))}
              />
            )}
            {phase === "submitted" && (
              <ApplicationReceived
                state={state}
                onContinue={() => go("documents", {})}
                saving={saving}
              />
            )}
            {(phase === "documents" || phase === "profile_complete") && (
              <DriverProfile
                token={token}
                state={state}
                update={update}
                phase={phase}
                onFinish={async () => {
                  await go("profile_complete", {});
                  // Done for now: stop this tab holding a credential for a
                  // flow nobody is in any more. The emailed link still works.
                  clearResumeToken();
                }}
                saving={saving}
              />
            )}

            {inPart1 && (
              <p className="mt-6 text-center text-[11px] text-muted-foreground lg:hidden">
                No documents needed to apply · No payment required.
              </p>
            )}
          </div>
        </FadeUp>
      </div>
    </div>
  );
}

function LinkExpired({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">We Couldn't Open That Link</h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{message}</p>
      <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href="mailto:team@drivereal.com"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-real-red px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
        >
          <Mail className="h-4 w-4" /> Ask Us For A New Link
        </a>
        <Link
          to="/apply"
          className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-6 py-3 text-sm font-medium hover:border-foreground/40"
        >
          Start A New Application
        </Link>
      </div>
    </div>
  );
}

function SideRail({ phase, source }: { phase: Phase; source: string | null | undefined }) {
  const inPart1 = phase === "rental" || phase === "driving";
  const segments = getBarSegments(source);
  const currentIdx = segments.findIndex((s) => s.key === phase);
  return (
    <aside className="hidden lg:flex flex-col bg-[#141416] text-white p-8">
      <div>
        {/* The same mark the rest of the site uses, not a second treatment of
            it. This rail used to draw its own: a red "REAL" pill beside spaced
            "RENTALS" text, which is not the logo — the logo is a red block
            with a white inner rule and the two words stacked inside it. Not a
            link, because an applicant mid-form should not lose their place by
            tapping the branding. */}
        <Logo width={104} offset={false} href={false} />
        <h2 className="mt-8 text-2xl font-semibold leading-snug">
          {inPart1 ? "Quick Application" : "Your Application Is In"}
        </h2>
        <p className="mt-3 text-sm text-white/60 leading-relaxed">
          {inPart1
            ? "A handful of questions about what you drive and what you need. No documents, no uploads."
            : "Everything below is optional. Photos save as soon as they upload; press Save under anything you type."}
        </p>
        {inPart1 && (
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
        )}
      </div>
      <p className="mt-auto pt-10 text-[11px] text-white/40">No payment required to apply.</p>
    </aside>
  );
}

// ------------------------------------------------------------- shared bits

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

function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`rounded-lg border px-4 py-2.5 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function YesNo({
  label,
  value,
  onChange,
  yesLabel = "Yes",
  noLabel = "No",
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-2 flex gap-2">
        {[true, false].map((v) => {
          const active = value === v;
          return (
            <button
              key={String(v)}
              type="button"
              onClick={() => onChange(v)}
              className={`rounded-lg border px-5 py-2.5 text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
            >
              {v ? yesLabel : noLabel}
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
  // Sticky on phones, inline on desktop. A long step used to scroll its own
  // Submit button off the bottom of the screen, so the applicant reached the
  // end of the questions and found nothing to press.
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

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
      />
    </label>
  );
}

type StepProps = {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  saving: boolean;
};

// ------------------------------------------------------- Part 1, step one

function RentalStep({ state, update, saving, onNext }: StepProps & { onNext: () => void }) {
  const [editingPlace, setEditingPlace] = useState(false);
  // Whatever the date box held when this step first mounted came from the lead
  // form, not from this screen. Captured once so the note does not linger after
  // they have picked a new date themselves.
  const [carriedDate] = useState(() => Boolean(state.pickup_date));
  const canNext = !!state.vehicle_size && !!state.pickup_date && !!state.expected_duration;
  const today = new Date().toISOString().slice(0, 10);
  const place = [state.city, state.state].filter(Boolean).join(", ");

  return (
    <div>
      <StepHeader
        eyebrow="Quick Application · Step 1 Of 2"
        title="What Do You Need?"
        sub="Three questions. No documents and no payment to apply."
      />
      <div className="space-y-5">
        {/* Carried forward from the form they already filled in. Shown, not
            re-asked — but editable, because a wrong city silently attached to
            an application is worse than one extra tap. */}
        {place && !editingPlace && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <MapPin className="h-4 w-4 text-real-red shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Picking Up In
                </div>
                <div className="text-sm font-medium truncate">{place}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditingPlace(true)}
              className="shrink-0 inline-flex items-center justify-center min-h-[44px] px-3 -mr-3 text-[11px] font-semibold text-real-red hover:underline"
            >
              Change
            </button>
          </div>
        )}
        {(editingPlace || !place) && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="City"
              value={state.city ?? ""}
              onChange={(v) => update("city", v || null)}
            />
            <TextField
              label="State"
              value={state.state ?? ""}
              onChange={(v) => update("state", v || null)}
            />
          </div>
        )}

        <Choice
          label="What Kind Of Vehicle Do You Want?"
          value={state.vehicle_size as (typeof VEHICLE_OPTS)[number] | null}
          options={VEHICLE_OPTS.map((v) => ({ value: v, label: v === "XL" ? "Minivan" : v }))}
          onChange={(v) => update("vehicle_size", v)}
        />

        <label className="block max-w-xs">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            When Do You Need The Vehicle?
          </span>
          <input
            type="date"
            min={today}
            value={state.pickup_date ?? ""}
            onChange={(e) => update("pickup_date", e.target.value || null)}
            className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
          />
          {/* Prefilled, and said out loud. A date box that silently arrives
              filled in reads as a default; saying where it came from makes it
              theirs, and makes changing it feel invited rather than risky. */}
          {carriedDate && (
            <span className="mt-1.5 block text-[11px] text-muted-foreground">
              We carried over the date you selected earlier. Update it if anything changed.
            </span>
          )}
        </label>

        <Choice
          label="How Long Do You Expect To Need The Vehicle?"
          hint="An estimate is fine — nothing here is binding."
          value={state.expected_duration as (typeof DURATION_OPTS)[number]["value"] | null}
          options={DURATION_OPTS}
          onChange={(v) => update("expected_duration", v)}
        />
      </div>
      <NavRow onNext={onNext} saving={saving} canNext={canNext} />
    </div>
  );
}

// ------------------------------------------------------- Part 1, step two

function DrivingStep({
  state,
  update,
  saving,
  onBack,
  onSubmit,
}: StepProps & { onBack: () => void; onSubmit: () => void }) {
  // Everything that establishes eligibility is answered here; trips, rating
  // and platforms are genuinely optional. A blank trip count means we do not
  // know it, and a driver who has not counted their trips is not turned away
  // at the door for it.
  const canSubmit = !!state.gig_status && !!state.drive_type && !!state.insurance_answer;
  const toggle = (p: string) => {
    update(
      "platforms",
      state.platforms.includes(p)
        ? state.platforms.filter((x) => x !== p)
        : [...state.platforms, p],
    );
  };

  return (
    <div>
      <StepHeader
        eyebrow="Quick Application · Step 2 Of 2"
        title="About Your Driving"
        sub="Answer what you know. Anything you're unsure about, leave it — we'll cover it on the call."
      />
      <div className="space-y-5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Which Gig Apps Do You Use?
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORM_OPTS.map((p) => {
              const active = state.platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(p)}
                  className={`rounded-lg border px-4 min-h-[44px] text-sm transition ${active ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground hover:border-foreground/40"}`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <Choice
          label="Are You Currently Active On A Gig App?"
          value={state.gig_status as (typeof GIG_STATUS_OPTS)[number]["value"] | null}
          options={GIG_STATUS_OPTS}
          onChange={(v) => update("gig_status", v)}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Roughly How Many Trips Have You Completed?
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
            <span className="mt-1 block text-[11px] text-muted-foreground">
              A rough number across all apps is fine. Leave blank if you're not sure.
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Driver Rating, If You Know It
            </span>
            <input
              type="number"
              step="0.01"
              min={1}
              max={5}
              placeholder="e.g. 4.92"
              value={state.rating ?? ""}
              onChange={(e) => {
                // min/max on a number input are not enforced as you type, and
                // the server schema is. An out-of-range rating used to fail
                // every save silently and then throw raw validation JSON at
                // the applicant from the Submit button, with nothing pointing
                // at this field. Clamped here instead.
                const raw = e.target.value;
                if (raw === "") return update("rating", null);
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                update("rating", Math.min(5, Math.max(1, n)));
              }}
              className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Out of 5. Leave blank if you're not sure.
            </span>
          </label>
        </div>

        <Choice
          label="How Do You Plan To Drive?"
          value={state.drive_type as (typeof DRIVE_TYPE_OPTS)[number]["value"] | null}
          options={DRIVE_TYPE_OPTS}
          onChange={(v) => update("drive_type", v)}
        />

        <Choice
          label="Do You Have Full Coverage Insurance?"
          hint="If you're not sure, say so — that's a real answer and we'll check it with you."
          value={state.insurance_answer as (typeof INSURANCE_OPTS)[number]["value"] | null}
          options={INSURANCE_OPTS}
          onChange={(v) => update("insurance_answer", v)}
        />
        {state.insurance_answer === "no" && (
          <div className="rounded-xl border border-border bg-soft p-4 text-sm text-muted-foreground">
            No problem — coverage is not required to apply. Our team will walk you through the
            options that work for your situation when we call.
          </div>
        )}
        {state.insurance_answer === "not_sure" && (
          <div className="rounded-xl border border-border bg-soft p-4 text-sm text-muted-foreground">
            That's fine. Most policies say it on the card, and we'll work it out together — it does
            not hold up your application.
          </div>
        )}
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

// ----------------------------------------------------------- the handover

function ApplicationReceived({
  state,
  onContinue,
  saving,
}: {
  state: WizardState;
  onContinue: () => void;
  saving: boolean;
}) {
  const firstName = (state.full_name || "").trim().split(/\s+/)[0] || "there";
  const chips = [
    state.city ? { icon: <MapPin className="h-3.5 w-3.5" />, label: state.city } : null,
    state.vehicle_size
      ? { icon: <Car className="h-3.5 w-3.5" />, label: state.vehicle_size }
      : null,
    state.pickup_date
      ? { icon: <CalendarCheck className="h-3.5 w-3.5" />, label: fmtDate(state.pickup_date) }
      : null,
  ].filter(Boolean) as { icon: React.ReactNode; label: string }[];

  return (
    <div className="py-2">
      <div className="flex flex-col items-center text-center">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-[#FCEBEB] text-real-red">
          <Check className="h-8 w-8" strokeWidth={2.5} />
        </div>
        <h2 className="mt-6 text-2xl md:text-3xl font-semibold tracking-tight">
          Application Received
        </h2>
        <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-xl leading-snug">
          Thanks, {firstName}. Your application is with our team — nothing else is required from you
          for us to review it and get in touch.
        </p>
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

      <div className="mt-8 rounded-2xl border border-border bg-white p-5 md:p-6">
        <div className="flex items-start gap-3">
          <ListChecks className="h-5 w-5 text-real-red shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Complete Your Driver Profile</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              Your licence, insurance and gig screenshots are what we need before you can pick a car
              up. Doing it now saves a round of back-and-forth later — but it is optional, it saves
              as you go, and this link brings you back to it.
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onContinue}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-real-red px-6 min-h-[48px] text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue With Documents <ArrowRight className="h-4 w-4" />
          </button>
          <Link
            to="/fleet"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-6 min-h-[48px] text-sm font-medium hover:border-foreground/40"
          >
            I'll Do This Later
          </Link>
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-white border border-border p-4">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
          Questions Now?
        </div>
        {/*
          py/-my rather than a taller row: this is the only way to reach a
          human from the handover screen, and at 20px tall it sat under the
          24px WCAG 2.5.8 floor, which only exempts targets inside a sentence.
          The padding grows the touch area to 40px without moving anything.
        */}
        <a
          href="mailto:team@drivereal.com"
          className="inline-flex items-center gap-2 py-2.5 -my-2.5 text-sm font-semibold text-foreground hover:text-real-red break-all"
        >
          <Mail className="h-4 w-4 text-real-red" /> team@drivereal.com
        </a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Part 2

type Section = {
  key: string;
  title: string;
  blurb: string;
  icon: React.ReactNode;
  done: boolean;
};

function DriverProfile({
  token,
  state,
  update,
  phase,
  onFinish,
  saving,
}: StepProps & { token: string; phase: Phase; onFinish: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const updateStep = useServerFn(updateApplicationStep);

  /**
   * Each section writes on its own, so a half-finished profile is never lost
   * and one failed save does not take the others with it.
   *
   * `step` stays on whatever phase the application is already in. It used to
   * be hardcoded to "documents", so saving one section on a finished profile
   * walked current_step backwards from profile_complete.
   */
  const saveSection = async (
    key: string,
    payload: Record<string, unknown>,
    opts: { quiet?: boolean } = {},
  ) => {
    if (!opts.quiet) setSavingSection(key);
    try {
      await updateStep({ data: { token, step: phase, ...payload } as never });
      if (!opts.quiet) {
        toast.success("Saved");
        setOpen(null);
      }
    } catch (e: unknown) {
      if (!opts.quiet) {
        toast.error(e instanceof Error ? e.message : "Could not save. Please try again.");
      }
    } finally {
      if (!opts.quiet) setSavingSection(null);
    }
  };

  /**
   * A file that reached storage but whose path never reached the row is a file
   * nobody can find: the object exists, no column points at it, and the vault
   * sync never sees it. Part 2 does not autosave, so an applicant who
   * photographs their licence, sees the tick and closes the tab used to lose
   * it. The path is written the moment the upload returns.
   */
  const persistUpload = (
    column: "license_photo_url" | "insurance_doc_url" | "profile_screenshot_url",
    presence: "license_photo_on_file" | "insurance_doc_on_file" | "profile_screenshot_on_file",
    path: string | null,
  ) => {
    update(presence, Boolean(path));
    void saveSection("upload", { [column]: path }, { quiet: true });
  };

  /** Trip screenshots: the session's new paths, plus which stored ones survive. */
  const persistTripScreenshots = (added: string[], keep: string[]) => {
    update("trip_screenshots_added", added);
    update("trip_screenshots_keep", keep);
    void saveSection(
      "upload",
      { trip_screenshots: added, trip_screenshots_keep: keep },
      { quiet: true },
    );
  };

  const sections: Section[] = useMemo(
    () => [
      {
        key: "license",
        title: "Driver's Licence",
        blurb: "A photo of the front, and confirmation it's current.",
        icon: <IdCard className="h-5 w-5" />,
        done: state.license_photo_on_file && state.license_valid === true,
      },
      {
        key: "insurance",
        title: "Insurance",
        blurb: "Your insurance card or declaration page.",
        icon: <ShieldCheck className="h-5 w-5" />,
        done: state.insurance_doc_on_file,
      },
      {
        key: "gig_profile",
        title: "Gig Profile",
        blurb: "A screenshot of your driver profile showing your rating.",
        icon: <Smartphone className="h-5 w-5" />,
        done: state.profile_screenshot_on_file,
      },
      {
        key: "trips",
        title: "Trip History",
        blurb: "A screenshot of your lifetime trip or delivery count.",
        icon: <ListChecks className="h-5 w-5" />,
        done: state.trip_screenshots_keep.length + state.trip_screenshots_added.length > 0,
      },
      {
        key: "address",
        title: "Your Address",
        blurb: "Where you live — needed on the rental agreement.",
        icon: <MapPin className="h-5 w-5" />,
        done: Boolean(state.address && state.zip),
      },
    ],
    [state],
  );

  const doneCount = sections.filter((s) => s.done).length;

  return (
    <div>
      <StepHeader
        eyebrow="Complete Your Driver Profile"
        title={`${doneCount} Of ${sections.length} Done`}
        sub="Photos upload and save straight away. For the typed details, press Save in each section — then you can close the page and come back with the same link."
      />

      {/* Deliberately no qualification score, coverage percentage, readiness
          state or Hot Prospect anything. Those are internal triage tools; an
          applicant seeing a percentage against their name would read it as a
          verdict, and it is not one. */}

      <div className="space-y-3">
        {sections.map((s) => {
          const isOpen = open === s.key;
          return (
            <div key={s.key} className="rounded-2xl border border-border bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : s.key)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-soft/60 transition"
              >
                <span
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${s.done ? "bg-emerald-50 text-emerald-700" : "bg-soft text-muted-foreground"}`}
                >
                  {s.done ? <Check className="h-5 w-5" strokeWidth={3} /> : s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{s.title}</span>
                  <span className="block text-[13px] text-muted-foreground truncate">
                    {s.blurb}
                  </span>
                </span>
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </button>

              {isOpen && (
                <div className="border-t border-border p-4 space-y-4">
                  {s.key === "license" && (
                    <>
                      <DocumentCapture
                        title="Driver's licence"
                        hint="Take a photo of the front of your licence."
                        tips={[
                          "All four corners in the frame",
                          "No glare across the text",
                          "Close enough to read your name and the expiry date",
                        ]}
                        kind="license"
                        token={token}
                        onFile={state.license_photo_on_file}
                        onChange={(v) =>
                          persistUpload("license_photo_url", "license_photo_on_file", v)
                        }
                      />
                      <YesNo
                        label="Is Your Licence Current And Valid?"
                        value={state.license_valid}
                        onChange={(v) => update("license_valid", v)}
                      />
                      <SectionSave
                        busy={savingSection === s.key}
                        onSave={() =>
                          saveSection(s.key, {
                            license_valid: state.license_valid,
                          })
                        }
                      />
                    </>
                  )}

                  {s.key === "insurance" && (
                    <InsuranceSection
                      token={token}
                      state={state}
                      update={update}
                      persistUpload={persistUpload}
                      busy={savingSection === s.key}
                      onSave={() =>
                        saveSection(s.key, {
                          insurance_carrier: state.insurance_carrier,
                          // Only sent when the applicant typed a replacement.
                          ...(state.insurance_policy_number
                            ? { insurance_policy_number: state.insurance_policy_number }
                            : {}),
                          insurance_expires_on: state.insurance_expires_on,
                          insurance_rideshare_endorsement: state.insurance_rideshare_endorsement,
                        })
                      }
                    />
                  )}

                  {s.key === "gig_profile" && (
                    <>
                      <DocumentCapture
                        title="Gig driver profile"
                        hint="A screenshot of your profile screen showing your name and rating."
                        tips={["Your rating should be readable", "Any app is fine"]}
                        kind="gig_profile"
                        token={token}
                        onFile={state.profile_screenshot_on_file}
                        onChange={(v) =>
                          persistUpload("profile_screenshot_url", "profile_screenshot_on_file", v)
                        }
                      />
                      <SectionSave
                        busy={savingSection === s.key}
                        onSave={() =>
                          saveSection(s.key, {})
                        }
                      />
                    </>
                  )}

                  {s.key === "trips" && (
                    <>
                      <MultiFileUpload
                        label="Trip / Delivery Totals"
                        hint="A screenshot showing your lifetime trips or deliveries from any app. One per app is best."
                        token={token}
                        storedNames={state.trip_screenshot_names}
                        keep={state.trip_screenshots_keep}
                        added={state.trip_screenshots_added}
                        onChange={persistTripScreenshots}
                      />
                      <SectionSave
                        busy={savingSection === s.key}
                        onSave={() => saveSection(s.key, {})}
                      />
                    </>
                  )}

                  {s.key === "address" && (
                    <>
                      <p className="text-[13px] text-muted-foreground leading-relaxed">
                        This goes on your rental agreement, so it needs to match the address on your
                        licence.
                      </p>
                      <TextField
                        label="Street Address"
                        value={state.address ?? ""}
                        onChange={(v) => update("address", v || null)}
                      />
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <TextField
                          label="City"
                          value={state.city ?? ""}
                          onChange={(v) => update("city", v || null)}
                        />
                        <TextField
                          label="State"
                          value={state.state ?? ""}
                          onChange={(v) => update("state", v || null)}
                        />
                        <TextField
                          label="ZIP"
                          value={state.zip ?? ""}
                          onChange={(v) => update("zip", v || null)}
                        />
                      </div>
                      <SectionSave
                        busy={savingSection === s.key}
                        onSave={() =>
                          saveSection(s.key, {
                            address: state.address,
                            city: state.city,
                            state: state.state,
                            zip: state.zip,
                          })
                        }
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onFinish}
          disabled={saving}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-real-red px-6 min-h-[48px] text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {phase === "profile_complete" ? "Profile Submitted" : "I'm Done For Now"}
        </button>
        <Link
          to="/fleet"
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-border bg-white px-6 min-h-[48px] text-sm font-medium hover:border-foreground/40"
        >
          Browse Vehicles
        </Link>
      </div>

      <p className="mt-5 text-center text-[11px] text-muted-foreground">
        Your application is already with our team. Nothing above is required for us to call you.
      </p>
    </div>
  );
}

function SectionSave({ busy, onSave }: { busy: boolean; onSave: () => void }) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={busy}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#111114] px-5 min-h-[44px] text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      Save
    </button>
  );
}

/**
 * Insurance, document first.
 *
 * The old version asked "do you have full coverage?" and then made the
 * applicant type a carrier, a policy number and an expiry date from a card
 * that was sitting in front of them — four fields of transcription before the
 * photo was even taken. Now the card goes up first and the fields are a short,
 * optional confirmation underneath it.
 *
 * EXTENSION POINT — nothing here extracts anything. When document extraction
 * exists it should prefill these inputs and leave them editable, and whatever
 * it produces stays self-reported until a staff member marks the document
 * verified in the vault. An extracted value must never be presented to the
 * applicant, or stored, as though we had confirmed it.
 */
function InsuranceSection({
  token,
  state,
  update,
  persistUpload,
  busy,
  onSave,
}: Omit<StepProps, "saving"> & {
  token: string;
  persistUpload: (
    column: "license_photo_url" | "insurance_doc_url" | "profile_screenshot_url",
    presence: "license_photo_on_file" | "insurance_doc_on_file" | "profile_screenshot_on_file",
    path: string | null,
  ) => void;
  busy: boolean;
  onSave: () => void;
}) {
  const [replacingPolicy, setReplacingPolicy] = useState(false);
  return (
    <>
      <DocumentCapture
        title="Insurance card"
        hint="Photograph your insurance card or declaration page."
        tips={["Show the policy number and the dates it covers"]}
        kind="insurance"
        token={token}
        onFile={state.insurance_doc_on_file}
        onChange={(v) => persistUpload("insurance_doc_url", "insurance_doc_on_file", v)}
      />
      {state.insurance_doc_on_file && (
        <div className="space-y-4 rounded-xl border border-border bg-soft p-4">
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Got it. If you can read these off the card, it saves us a call — all optional.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label="Insurance Carrier"
              value={state.insurance_carrier ?? ""}
              onChange={(v) => update("insurance_carrier", v || null)}
            />
            {/* Already given us a policy number? Then it stays where it is.
                The server returns the last four so it can be recognised, not
                the number itself — a resume link is a bearer credential and
                should let somebody carry on, not read back everything they
                have ever handed over. */}
            {state.insurance_policy_on_file && !replacingPolicy ? (
              <div className="block">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Policy Number
                </span>
                <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 py-2.5">
                  <span className="text-sm">
                    <span className="font-mono">••••{state.insurance_policy_last4}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">Already Provided</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplacingPolicy(true)}
                    className="shrink-0 inline-flex items-center min-h-[44px] px-2 -mr-2 text-[11px] font-semibold text-real-red hover:underline"
                  >
                    Update
                  </button>
                </div>
              </div>
            ) : (
              <TextField
                label="Policy Number"
                value={state.insurance_policy_number ?? ""}
                onChange={(v) => update("insurance_policy_number", v || null)}
              />
            )}
          </div>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Policy Expiration Date
            </span>
            <input
              type="date"
              value={state.insurance_expires_on ?? ""}
              onChange={(e) => update("insurance_expires_on", e.target.value || null)}
              className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm"
            />
          </label>
          <YesNo
            label="Does Your Policy Include A Rideshare Endorsement?"
            value={state.insurance_rideshare_endorsement}
            onChange={(v) => update("insurance_rideshare_endorsement", v)}
            noLabel="Not Sure"
          />
        </div>
      )}
      <SectionSave busy={busy} onSave={onSave} />
    </>
  );
}

/**
 * Trip screenshots, without the browser ever holding a storage path it did
 * not create.
 *
 * Files already on the record arrive as display names only. Removing one is
 * expressed as "keep these indices", which the server resolves against the
 * stored array — so the applicant can delete a wrong screenshot without us
 * handing back the paths of the right ones.
 */
function MultiFileUpload({
  label,
  hint,
  token,
  storedNames,
  keep,
  added,
  onChange,
}: {
  label: string;
  hint?: string;
  token: string;
  storedNames: string[];
  /** Filenames, not positions. Positions drift when the array is rewritten. */
  keep: string[];
  added: string[];
  onChange: (added: string[], keep: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** The screenshot a retake is about to stand in for, if any. */
  const [replacing, setReplacing] = useState<
    { name: string; stored: boolean; path?: string } | null
  >(null);

  /**
   * One entry point for both inputs, and for both a fresh upload and a
   * retake. A replacement runs the identical pipeline — optimize, size,
   * MIME, signed upload — and only then retires the file it stands in for,
   * so a failed retake leaves the original in place.
   */
  async function receive(files: FileList) {
    const target = replacing;
    if (!target) return handleFiles(files);
    setReplacing(null);
    const before = added;
    await handleFiles(files, (uploaded) => {
      if (!uploaded.length) return null;
      const nextAdded = target.stored
        ? [...before, ...uploaded]
        : [...before.filter((p) => p !== target.path), ...uploaded];
      const nextKeep = target.stored ? keep.filter((n) => n !== target.name) : keep;
      return { added: nextAdded, keep: nextKeep };
    });
  }

  async function handleFiles(
    files: FileList,
    resolve?: (uploaded: string[]) => { added: string[]; keep: string[] } | null,
  ) {
    // Only ten are kept, so only ten are uploaded. Slicing after the loop
    // meant selecting thirty screenshots uploaded thirty files, threw away
    // twenty, and spent thirty of the hour's forty signed-URL grants doing
    // it — on the one screen where a slow connection already makes retries
    // likely.
    const room = resolve ? 1 : Math.max(0, 10 - (keep.length + added.length));
    const chosen = Array.from(files).slice(0, room);
    if (files.length > chosen.length) {
      toast.info(
        room === 0
          ? "You already have ten screenshots. Remove one to add another."
          : `Taking the first ${room} — ten screenshots is the most we need.`,
      );
    }
    if (!chosen.length) return;
    setUploading(true);
    const uploaded: string[] = [];
    try {
      for (const file of chosen) {
        try {
          const { path } = await uploadApplicantFile({ token, kind: "trip_history", file });
          uploaded.push(path);
        } catch (e) {
          console.error("[upload] failed", e);
          toast.error(
            e instanceof UploadTooLarge
              ? `${file.name}: ${e.message}`
              : "We couldn't upload that file. Please try again — or email it to team@drivereal.com and we'll attach it for you.",
          );
        }
      }
      if (uploaded.length) {
        const next = resolve?.(uploaded);
        if (next) {
          onChange(next.added.slice(0, 10), next.keep);
          toast.success("Replaced");
        } else {
          onChange([...added, ...uploaded].slice(0, 10), keep);
          toast.success(`Uploaded ${uploaded.length}`);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  const rows = [
    ...storedNames.map((name) => ({ name, stored: true as const })),
    ...added.map((path) => ({
      name: path.split("/").pop() ?? path,
      stored: false as const,
      path,
    })),
  ].filter((r) => (r.stored ? keep.includes(r.name) : true));

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      {/* Take Photo and Choose File, on the first upload and on every retake.
          This step used to offer a bare file input, so an applicant on a
          phone who wanted to re-shoot a trip screenshot was sent to their
          photo library instead of the camera — the one screen where the
          thing they are photographing is on the device in their hand. Both
          inputs feed the same handler, so orientation, optimization, size
          and MIME validation and the signed upload are identical either
          way. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void receive(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void receive(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => cameraInput.current?.click()}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl bg-[#111114] text-white text-[14px] font-semibold disabled:opacity-50 active:scale-[0.99] transition-transform"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          {replacing ? "Retake Photo" : "Take Photo"}
        </button>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl border border-border bg-white text-[#111114] text-[14px] font-semibold disabled:opacity-50 active:scale-[0.99] transition-transform"
        >
          <Upload className="h-4 w-4" />
          {replacing ? "Choose Different File" : "Choose File"}
        </button>
      </div>
      {replacing && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-[#FFF8E5] border border-[#F6E7B8] px-3 py-2">
          <span className="text-[12px] text-[#8A6A00] truncate">
            Replacing {replacing.name}
          </span>
          <button
            type="button"
            onClick={() => setReplacing(null)}
            className="shrink-0 text-[12px] font-semibold text-[#8A6A00] underline"
          >
            Cancel
          </button>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li
              key={`${r.stored ? "s" : "a"}-${r.stored ? r.name : (r as { path: string }).path}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-white px-3 py-2 text-sm"
            >
              <span className="truncate text-muted-foreground">
                {r.name}
                {r.stored && (
                  <span className="ml-2 text-[11px] text-muted-foreground/70">On File</span>
                )}
              </span>
              <span className="shrink-0 flex items-center gap-1">
                {/* Retake arms the replacement, then the same two buttons
                    above do the capture — one implementation, whether this
                    is the first screenshot or the third attempt at it. */}
                <button
                  type="button"
                  onClick={() => {
                    setReplacing({
                      name: r.name,
                      stored: r.stored,
                      path: r.stored ? undefined : (r as { path: string }).path,
                    });
                    cameraInput.current?.click();
                  }}
                  className="inline-flex items-center gap-1 min-h-[44px] px-2 text-[11px] font-semibold text-[#55555E] hover:underline"
                >
                  <Camera className="h-3 w-3" /> Retake
                </button>
                <button
                  type="button"
                  onClick={() =>
                    r.stored
                      ? onChange(
                          added,
                          keep.filter((n) => n !== r.name),
                        )
                      : onChange(
                          added.filter((p) => p !== (r as { path: string }).path),
                          keep,
                        )
                  }
                  className="inline-flex items-center min-h-[44px] px-2 -mr-2 text-[11px] font-semibold text-real-red hover:underline"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
