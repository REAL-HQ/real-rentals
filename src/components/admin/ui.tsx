import type { ReactNode } from "react";
import { Check, ArrowRight, ArrowUp, ArrowDown, AlertTriangle, HelpCircle } from "lucide-react";
import {
  nextActions,
  STATE_SHORT,
  STATE_TONE,
  type ReadinessResult,
  type ReadinessState,
} from "@/lib/readiness";

// ---- Design tokens (shared across admin) --------------------------------
// Canvas #FAFAFB · Card #FFFFFF · Border #EDEDF0 · Ink #111114 · Sub #55555E
// Muted #9A9AA3 · Accent #D03020 · Semantic: green #50C060 · amber #C68A12
// · red #D03020 · neutral gray. Type: DM Sans. Micro-label 10px uppercase
// tracking-[0.12em] #9A9AA3 semibold. Icons Lucide 18px stroke 1.75.

type Tone = "green" | "amber" | "red" | "neutral";

const TONE: Record<Tone, { bg: string; fg: string; ring: string }> = {
  green: { bg: "rgba(80,192,96,0.08)", fg: "#50C060", ring: "#50C060" },
  amber: { bg: "rgba(240,192,64,0.08)", fg: "#C68A12", ring: "#C68A12" },
  red: { bg: "rgba(208,48,32,0.08)", fg: "#D03020", ring: "#D03020" },
  neutral: { bg: "rgba(85,85,94,0.08)", fg: "#55555E", ring: "#9A9AA3" },
};

// Map any status string to a semantic tone.
export function toneFor(status?: string | null): Tone {
  return toneForImpl(status);
}

/** Shared empty state for admin tables, lists and cards. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#EDEDF0] bg-white px-6 py-10 text-center ${className}`}
    >
      {icon && <div className="mb-1 text-[#C7C7CC]">{icon}</div>}
      <div className="text-[13px] font-semibold text-[#111114]">{title}</div>
      {hint && <div className="text-[12px] text-[#9A9AA3] max-w-[320px]">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function toneForImpl(status?: string | null): Tone {
  const s = (status ?? "").toLowerCase();
  if (
    [
      "active",
      "paid",
      "complete",
      "approved",
      "passed",
      "current",
      "succeeded",
      "completed",
      "on",
    ].some((k) => s.includes(k))
  )
    return "green";
  if (
    [
      "pending",
      "review",
      "reviewing",
      "new",
      "screening",
      "partial",
      "waiting",
      "draft_review",
    ].some((k) => s.includes(k))
  )
    return "amber";
  if (
    [
      "past_due",
      "late",
      "failed",
      "declined",
      "suspended",
      "flagged",
      "collections",
      "overdue",
      "cancelled",
      "canceled",
    ].some((k) => s.includes(k))
  )
    return "red";
  return "neutral";
}

export function StatusPill({
  status,
  tone,
  children,
  className = "",
}: {
  status?: string | null;
  tone?: Tone;
  children?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone ?? toneFor(status)];
  const label = children ?? (status ? String(status).replace(/_/g, " ") : "—");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${className}`}
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {label}
    </span>
  );
}

export function MicroLabel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3] ${className}`}
    >
      {children}
    </div>
  );
}

// ---- SectionCard: canonical white surface --------------------------------

export function SectionCard({
  title,
  subtitle,
  right,
  icon,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-[#EDEDF0] bg-white shadow-sm ${className}`}>
      {(title || right) && (
        <header className="flex items-center gap-3 border-b border-[#EDEDF0] px-5 py-3.5">
          {icon && <span className="text-[#55555E]">{icon}</span>}
          <div className="min-w-0 flex-1">
            {title && (
              <div className="text-[13px] font-semibold text-[#111114] truncate">{title}</div>
            )}
            {subtitle && (
              <div className="text-[11px] text-[#9A9AA3] mt-0.5 truncate">{subtitle}</div>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

// ---- MetricCard ---------------------------------------------------------

export function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  deltaLabel,
  urgent,
}: {
  icon: any;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: number;
  deltaLabel?: string;
  urgent?: boolean;
}) {
  const hasDelta = typeof delta === "number";
  const positive = (delta ?? 0) >= 0;
  return (
    <div
      className={`rounded-2xl border px-5 py-4 shadow-sm transition-colors ${
        urgent
          ? "bg-[#D03020] text-white border-transparent"
          : "bg-white text-[#111114] border-[#EDEDF0]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div
          className={`h-8 w-8 rounded-full grid place-items-center ${
            urgent ? "bg-white/15 text-white" : "bg-[#F4F4F6] text-[#55555E]"
          }`}
        >
          <Icon className="w-4 h-4" strokeWidth={1.75} />
        </div>
        {hasDelta && (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
              urgent ? "text-white/90" : positive ? "text-[#50C060]" : "text-[#D03020]"
            }`}
          >
            {positive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {Math.abs(delta!)}%
          </span>
        )}
      </div>
      <div
        className={`mt-3 text-[24px] leading-none font-semibold tracking-tight tabular-nums ${urgent ? "text-white" : "text-[#111114]"}`}
      >
        {value}
      </div>
      <div
        className={`mt-1 text-[12px] font-medium ${urgent ? "text-white/90" : "text-[#111114]"}`}
      >
        {label}
      </div>
      {hint && (
        <div className={`mt-0.5 text-[11px] ${urgent ? "text-white/70" : "text-[#55555E]"}`}>
          {hint}
        </div>
      )}
      {deltaLabel && hasDelta && (
        <div className={`mt-0.5 text-[10px] ${urgent ? "text-white/60" : "text-[#9A9AA3]"}`}>
          {deltaLabel}
        </div>
      )}
    </div>
  );
}

// ---- Lifecycle rail (horizontal, driver profile) -----------------------

export type LifecycleStage = {
  key: string;
  label: string;
  state: "done" | "current" | "upcoming";
};

export function LifecycleRail({
  stages,
  percent,
  timeInStage,
  blocker,
  className = "",
}: {
  stages: LifecycleStage[];
  percent?: number;
  timeInStage?: string;
  blocker?: string;
  className?: string;
}) {
  const currentIdx = Math.max(
    0,
    stages.findIndex((s) => s.state === "current"),
  );
  const current = stages[currentIdx] ?? stages[stages.length - 1];
  const upcoming = stages[currentIdx + 1];
  return (
    <section className={`rounded-2xl border border-[#EDEDF0] bg-white p-5 shadow-sm ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div className="min-w-0">
          <MicroLabel>Driver Lifecycle</MicroLabel>
          <div className="mt-1 text-[15px] font-semibold text-[#111114] truncate">
            {current?.label ?? "—"}
            {timeInStage && (
              <span className="ml-2 text-[12px] font-normal text-[#9A9AA3]">
                · {timeInStage} in stage
              </span>
            )}
          </div>
          {blocker && (
            <div className="text-[12px] text-[#D03020] mt-0.5 truncate">Blocker: {blocker}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[22px] font-semibold text-[#111114] tabular-nums leading-none">
            {percent ?? 0}%
          </div>
          {upcoming && (
            <div className="text-[11px] text-[#9A9AA3] mt-1">Next: {upcoming.label}</div>
          )}
        </div>
      </div>
      <ol className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {stages.map((s, i) => {
          const done = s.state === "done";
          const cur = s.state === "current";
          return (
            <li key={s.key} className="flex items-center gap-1.5 shrink-0">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`h-6 w-6 rounded-full grid place-items-center border-2 text-[10px] font-semibold ${
                    done
                      ? "bg-[#50C060] border-[#50C060] text-white"
                      : cur
                        ? "bg-white border-[#D03020] text-[#D03020] ring-4 ring-[#D03020]/10"
                        : "bg-white border-[#EDEDF0] text-[#C4C4CB]"
                  }`}
                >
                  {done ? <Check className="w-3 h-3" strokeWidth={2.5} /> : i + 1}
                </span>
                <span
                  className={`text-[10px] font-medium whitespace-nowrap ${
                    cur ? "text-[#111114]" : done ? "text-[#55555E]" : "text-[#9A9AA3]"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < stages.length - 1 && (
                <span
                  className="h-[2px] w-8 mt-[-14px] rounded"
                  style={{ backgroundColor: done ? "#50C060" : "#EDEDF0" }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---- Action queue row ---------------------------------------------------

export function ActionQueueRow({
  icon: Icon,
  label,
  count,
  description,
  action,
  tone = "neutral",
  onAction,
}: {
  icon: any;
  label: string;
  count: number;
  description?: string;
  action?: string;
  tone?: Tone;
  onAction?: () => void;
}) {
  const t = TONE[tone];
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-[#F4F4F6] last:border-0 hover:bg-[#FAFAFB] transition-colors">
      <div
        className="h-9 w-9 rounded-lg grid place-items-center shrink-0"
        style={{ backgroundColor: t.bg, color: t.fg }}
      >
        <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[#111114] truncate">{label}</div>
        {description && (
          <div className="text-[11px] text-[#55555E] mt-0.5 truncate">{description}</div>
        )}
      </div>
      <div className="text-[16px] font-semibold text-[#111114] tabular-nums shrink-0">{count}</div>
      {onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-[12px] text-[#55555E] hover:text-[#D03020] transition-colors shrink-0"
        >
          {action ?? "View"} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ---- Readiness -----------------------------------------------------------
//
// One rule governs everything in this section: a number never appears without
// the coverage that qualifies it. Qualification answers "of what we know, how
// good is it" and is meaningless alone — 100 on two answered questions is not
// a better applicant than 93 on eleven. So the state leads, the three figures
// travel together, and there is no single readiness score anywhere.
//
// The second rule: unknown is not bad. Missing information lives under Still
// Needed with the action that would collect it, never under Needs Attention.

const READINESS_TONE: Record<ReadinessState, Tone> = {
  needs_attention: "red",
  decision_ready: "green",
  promising_more_info: "amber",
  // Not red. We have not asked this person anything; that is our gap, not
  // their failing.
  more_info_needed: "neutral",
};

export function readinessTone(state: ReadinessState): Tone {
  return READINESS_TONE[state];
}

/** The state, as a pill. The only readiness headline there is. */
export function ReadinessStatePill({
  state,
  short = false,
  label,
}: {
  state: ReadinessState;
  short?: boolean;
  label?: string;
}) {
  const t = TONE[READINESS_TONE[state]];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {STATE_TONE[state] === "critical" && (
        <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={2.5} />
      )}
      {label ?? (short ? STATE_SHORT[state] : undefined) ?? STATE_SHORT[state]}
    </span>
  );
}

/**
 * Qualification, known coverage and verified coverage — always all three.
 *
 * `compact` is for table cells and the priority strip, where the full triple
 * would not fit. It still never shows qualification without coverage.
 */
export function ReadinessMetrics({
  result,
  compact = false,
}: {
  result: Pick<ReadinessResult, "qualification" | "coverage" | "verifiedCoverage">;
  compact?: boolean;
}) {
  if (result.qualification === null) {
    return <span className="text-[11px] text-[#9A9AA3]">Nothing recorded yet</span>;
  }
  if (compact) {
    return (
      <span className="text-[11px] text-[#55555E] tabular-nums whitespace-nowrap">
        Qual {result.qualification} · {result.coverage}% known
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="text-[13px] font-semibold text-[#111114] tabular-nums">
        Qualification {result.qualification}
      </span>
      <span className="text-[12px] text-[#55555E] tabular-nums">{result.coverage}% Known</span>
      <span className="text-[12px] text-[#55555E] tabular-nums">
        {result.verifiedCoverage}% Verified
      </span>
    </div>
  );
}

const EVIDENCE_LABEL = {
  self_reported: "Self-reported",
  document: "Document supported",
  staff_verified: "Staff verified",
} as const;

/**
 * The applicant readiness panel.
 *
 * Three lists, and which list a fact lands in is the whole point:
 *   Positive Signals — known and favourable
 *   Needs Attention  — known and concerning. Only ever known facts.
 *   Still Needed     — not asked yet, with the action that would ask
 *
 * `actions` receives buttons the caller has already confirmed lead somewhere
 * real. This component never invents one from a missing factor.
 */
export function ReadinessSummary({
  result,
  actions,
  primary,
}: {
  result: ReadinessResult;
  actions?: ReactNode;
  primary?: ReactNode;
}) {
  const gaps = nextActions(result);
  return (
    <section className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm overflow-hidden">
      <header className="px-5 py-4 border-b border-[#EDEDF0]">
        <div className="flex items-center gap-3">
          <ReadinessStatePill state={result.state} label={result.stateLabel} />
          <div className="text-[13px] font-semibold text-[#111114]">Applicant Readiness</div>
        </div>
        <div className="mt-2.5">
          <ReadinessMetrics result={result} />
        </div>
        {result.disqualifiers.length > 0 && (
          <ul className="mt-3 space-y-1">
            {result.disqualifiers.map((d) => (
              <li key={d} className="flex items-start gap-2 text-[12px] font-medium text-[#D03020]">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={2.5} />
                {d}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#EDEDF0]">
        <div className="p-5">
          <MicroLabel className="mb-2">Positive Signals</MicroLabel>
          {result.positives.length === 0 ? (
            <div className="text-[12px] text-[#9A9AA3]">Nothing favourable recorded yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {result.positives.map((f) => (
                <li key={f.key} className="flex items-start gap-2 text-[12px] text-[#111114]">
                  <Check className="w-3.5 h-3.5 mt-0.5 text-[#50C060] shrink-0" strokeWidth={2.5} />
                  <span className="min-w-0">
                    {f.detail}
                    {f.evidence && (
                      <span className="block text-[10px] text-[#9A9AA3]">
                        {EVIDENCE_LABEL[f.evidence]}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-5">
          <MicroLabel className="mb-2">Needs Attention</MicroLabel>
          {result.attention.length === 0 ? (
            <div className="text-[12px] text-[#9A9AA3]">Nothing concerning in what we know.</div>
          ) : (
            <ul className="space-y-1.5">
              {result.attention.map((f) => (
                <li key={f.key} className="flex items-start gap-2 text-[12px] text-[#111114]">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#D03020] shrink-0" />
                  <span className="min-w-0">
                    {f.detail}
                    {f.evidence && (
                      <span className="block text-[10px] text-[#9A9AA3]">
                        {EVIDENCE_LABEL[f.evidence]}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-5">
          <MicroLabel className="mb-2">Still Needed</MicroLabel>
          {gaps.length === 0 ? (
            <div className="text-[12px] text-[#9A9AA3]">Nothing outstanding.</div>
          ) : (
            <ul className="space-y-2.5">
              {gaps.map((g) => (
                <li key={g.remedy}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[#55555E]">{g.label}</span>
                    <span className="text-[10px] text-[#9A9AA3] tabular-nums whitespace-nowrap">
                      +{g.coverageGain}% known
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-start gap-2 text-[12px] text-[#55555E]">
                    <HelpCircle className="w-3.5 h-3.5 mt-0.5 text-[#C4C4CB] shrink-0" />
                    <span className="min-w-0">{g.factors.map((f) => f.label).join(", ")}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(actions || primary) && (
        <footer className="flex items-center justify-between gap-3 px-5 py-3.5 bg-[#FAFAFB] border-t border-[#EDEDF0]">
          <div className="min-w-0 flex flex-wrap items-center gap-2">{actions}</div>
          {primary && <div className="shrink-0">{primary}</div>}
        </footer>
      )}
    </section>
  );
}

// ---- Rental timeline (right-rail signature) -----------------------------

export type TimelineState = "done" | "current" | "upcoming";

export interface TimelineStep {
  label: string;
  state: TimelineState;
  timestamp?: string | null;
  hint?: string;
}

export function Timeline({
  steps,
  title = "Rental Timeline",
}: {
  steps: TimelineStep[];
  title?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white p-5 shadow-sm">
      <MicroLabel className="mb-4">{title}</MicroLabel>
      <ol className="relative">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const done = s.state === "done";
          const cur = s.state === "current";
          return (
            <li key={i} className="relative pl-8 pb-5 last:pb-0">
              {!last && (
                <span
                  className="absolute left-[11px] top-6 bottom-0 w-px"
                  style={{ backgroundColor: done ? "#50C060" : "#EDEDF0" }}
                />
              )}
              <span
                className={`absolute left-0 top-0.5 h-6 w-6 rounded-full grid place-items-center border-2 ${
                  done
                    ? "border-transparent"
                    : cur
                      ? "border-[#D03020] bg-white"
                      : "border-[#EDEDF0] bg-white"
                }`}
                style={done ? { backgroundColor: "#50C060" } : undefined}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
                ) : cur ? (
                  <span className="h-2 w-2 rounded-full bg-[#D03020]" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#D6D6DB]" />
                )}
              </span>
              <div className="flex items-baseline justify-between gap-3">
                <div
                  className={`text-[13px] font-medium ${done || cur ? "text-[#111114]" : "text-[#9A9AA3]"}`}
                >
                  {s.label}
                </div>
                {s.timestamp && (
                  <div className="text-[11px] text-[#9A9AA3] tabular-nums shrink-0">
                    {s.timestamp}
                  </div>
                )}
              </div>
              {s.hint && <div className="mt-0.5 text-[11px] text-[#55555E]">{s.hint}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---- Rental timeline builder from driver record -------------------------

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function buildDriverTimeline(driver: any, screening?: any): TimelineStep[] {
  const applied = driver.created_at;
  const status = String(driver.status ?? "").toLowerCase();
  const scrStatus = String(screening?.status ?? "").toLowerCase();
  const screeningDone = [
    "approved",
    "interview_completed",
    "interview_complete",
    "complete",
    "interview_done",
  ].some((k) => scrStatus.includes(k));
  const approved = status === "approved" || status === "active";
  const agreementSigned = !!driver.agreement_signed_at;
  const cardOnFile = !!driver.stripe_customer_id && !!driver.stripe_default_payment_method;
  const pickedUp = !!driver.pickup_at || status === "active";
  const active = status === "active";
  const returned = status === "closed" || status === "returned";

  const flags = [
    { done: !!applied, cur: false },
    { done: screeningDone, cur: !screeningDone && !!applied },
    { done: approved, cur: !approved && screeningDone },
    { done: agreementSigned, cur: !agreementSigned && approved },
    { done: cardOnFile, cur: !cardOnFile && agreementSigned },
    { done: pickedUp, cur: !pickedUp && cardOnFile },
    { done: active && !returned, cur: false },
    { done: returned, cur: false },
  ];
  // Ensure at most one "current" — the first not-done.
  let currentSet = false;
  const states: TimelineState[] = flags.map((f) => {
    if (f.done) return "done";
    if (!currentSet) {
      currentSet = true;
      return "current";
    }
    return "upcoming";
  });

  return [
    { label: "Applied", state: states[0], timestamp: fmtDate(applied) },
    { label: "Screening Complete", state: states[1], timestamp: fmtDate(screening?.updated_at) },
    { label: "Approved", state: states[2], timestamp: fmtDate(driver.approved_at) },
    { label: "Agreement Signed", state: states[3], timestamp: fmtDate(driver.agreement_signed_at) },
    { label: "Card On File", state: states[4], timestamp: cardOnFile ? "Saved" : null },
    { label: "Vehicle Picked Up", state: states[5], timestamp: fmtDate(driver.pickup_at) },
    { label: "Active", state: states[6], hint: active ? "Weekly autopay running" : undefined },
    { label: "Returned", state: states[7], timestamp: fmtDate(driver.return_at) },
  ];
}

export function buildVehicleTimeline(v: any): TimelineStep[] {
  const status = String(v.status ?? "").toLowerCase();
  const listed = status === "available" || status === "rented" || status === "maintenance";
  const rented = status === "rented";
  const inService = status === "maintenance";
  const retired = status === "retired";
  const flags = [true, !!v.prepped_at || listed, listed, rented, inService, retired];
  let currentSet = false;
  const states: TimelineState[] = flags.map((f) => {
    if (f) return "done";
    if (!currentSet) {
      currentSet = true;
      return "current";
    }
    return "upcoming";
  });
  return [
    { label: "Acquired", state: states[0], timestamp: fmtDate(v.acquired_at ?? v.created_at) },
    { label: "Prepped", state: states[1], timestamp: fmtDate(v.prepped_at) },
    { label: "Listed", state: states[2] },
    { label: "Rented", state: states[3] },
    { label: "In Service", state: states[4] },
    { label: "Retired", state: states[5] },
  ];
}
