import type { ReactNode } from "react";
import { Check, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";

// ---- Design tokens (shared across admin) --------------------------------
// Canvas #FAFAFB · Card #FFFFFF · Border #EDEDF0 · Ink #111114 · Sub #55555E
// Muted #9A9AA3 · Accent #CC0000 · Semantic: green #0F8A4B · amber #B77900
// · red #CC0000 · neutral gray. Type: DM Sans. Micro-label 10px uppercase
// tracking-[0.12em] #9A9AA3 semibold. Icons Lucide 18px stroke 1.75.

type Tone = "green" | "amber" | "red" | "neutral";

const TONE: Record<Tone, { bg: string; fg: string; ring: string }> = {
  green:   { bg: "rgba(15,138,75,0.08)",  fg: "#0F8A4B", ring: "#0F8A4B" },
  amber:   { bg: "rgba(183,121,0,0.08)",  fg: "#B77900", ring: "#B77900" },
  red:     { bg: "rgba(204,0,0,0.08)",    fg: "#CC0000", ring: "#CC0000" },
  neutral: { bg: "rgba(85,85,94,0.08)",   fg: "#55555E", ring: "#9A9AA3" },
};

// Map any status string to a semantic tone.
export function toneFor(status?: string | null): Tone {
  const s = (status ?? "").toLowerCase();
  if (["active","paid","complete","approved","passed","current","succeeded","completed","on"].some(k => s.includes(k))) return "green";
  if (["pending","review","reviewing","new","screening","partial","waiting","draft_review"].some(k => s.includes(k))) return "amber";
  if (["past_due","late","failed","declined","suspended","flagged","collections","overdue","cancelled","canceled"].some(k => s.includes(k))) return "red";
  return "neutral";
}

export function StatusPill({ status, tone, children, className = "" }: {
  status?: string | null; tone?: Tone; children?: ReactNode; className?: string;
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

export function MicroLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3] ${className}`}>
      {children}
    </div>
  );
}

// ---- SectionCard: canonical white surface --------------------------------

export function SectionCard({
  title, subtitle, right, icon, children, className = "", padded = true,
}: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: ReactNode;
  children: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-[#EDEDF0] bg-white shadow-sm ${className}`}>
      {(title || right) && (
        <header className="flex items-center gap-3 border-b border-[#EDEDF0] px-5 py-3.5">
          {icon && <span className="text-[#55555E]">{icon}</span>}
          <div className="min-w-0 flex-1">
            {title && <div className="text-[13px] font-semibold text-[#111114] truncate">{title}</div>}
            {subtitle && <div className="text-[11px] text-[#9A9AA3] mt-0.5 truncate">{subtitle}</div>}
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
  icon: Icon, label, value, hint, delta, deltaLabel, urgent,
}: {
  icon: any; label: string; value: ReactNode; hint?: ReactNode;
  delta?: number; deltaLabel?: string; urgent?: boolean;
}) {
  const hasDelta = typeof delta === "number";
  const positive = (delta ?? 0) >= 0;
  return (
    <div
      className={`rounded-2xl border px-5 py-4 shadow-sm transition-colors ${
        urgent ? "bg-[#CC0000] text-white border-transparent" : "bg-white text-[#111114] border-[#EDEDF0]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className={`h-8 w-8 rounded-full grid place-items-center ${
          urgent ? "bg-white/15 text-white" : "bg-[#F4F4F6] text-[#55555E]"
        }`}>
          <Icon className="w-4 h-4" strokeWidth={1.75} />
        </div>
        {hasDelta && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
            urgent
              ? "text-white/90"
              : positive
                ? "text-[#0F8A4B]"
                : "text-[#CC0000]"
          }`}>
            {positive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {Math.abs(delta!)}%
          </span>
        )}
      </div>
      <div className={`mt-3 text-[24px] leading-none font-semibold tracking-tight tabular-nums ${urgent ? "text-white" : "text-[#111114]"}`}>
        {value}
      </div>
      <div className={`mt-1 text-[12px] font-medium ${urgent ? "text-white/90" : "text-[#111114]"}`}>{label}</div>
      {hint && <div className={`mt-0.5 text-[11px] ${urgent ? "text-white/70" : "text-[#55555E]"}`}>{hint}</div>}
      {deltaLabel && hasDelta && (
        <div className={`mt-0.5 text-[10px] ${urgent ? "text-white/60" : "text-[#9A9AA3]"}`}>{deltaLabel}</div>
      )}
    </div>
  );
}

// ---- Lifecycle rail (horizontal, driver profile) -----------------------

export type LifecycleStage = {
  key: string; label: string; state: "done" | "current" | "upcoming";
};

export function LifecycleRail({
  stages, percent, timeInStage, blocker, className = "",
}: {
  stages: LifecycleStage[]; percent?: number; timeInStage?: string; blocker?: string; className?: string;
}) {
  const currentIdx = Math.max(0, stages.findIndex((s) => s.state === "current"));
  const current = stages[currentIdx] ?? stages[stages.length - 1];
  const upcoming = stages[currentIdx + 1];
  return (
    <section className={`rounded-2xl border border-[#EDEDF0] bg-white p-5 shadow-sm ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div className="min-w-0">
          <MicroLabel>Driver Lifecycle</MicroLabel>
          <div className="mt-1 text-[15px] font-semibold text-[#111114] truncate">
            {current?.label ?? "—"}
            {timeInStage && <span className="ml-2 text-[12px] font-normal text-[#9A9AA3]">· {timeInStage} in stage</span>}
          </div>
          {blocker && <div className="text-[12px] text-[#CC0000] mt-0.5 truncate">Blocker: {blocker}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[22px] font-semibold text-[#111114] tabular-nums leading-none">{percent ?? 0}%</div>
          {upcoming && <div className="text-[11px] text-[#9A9AA3] mt-1">Next: {upcoming.label}</div>}
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
                    done ? "bg-[#0F8A4B] border-[#0F8A4B] text-white"
                    : cur ? "bg-white border-[#CC0000] text-[#CC0000] ring-4 ring-[#CC0000]/10"
                    : "bg-white border-[#EDEDF0] text-[#C4C4CB]"
                  }`}
                >
                  {done ? <Check className="w-3 h-3" strokeWidth={2.5} /> : i + 1}
                </span>
                <span className={`text-[10px] font-medium whitespace-nowrap ${
                  cur ? "text-[#111114]" : done ? "text-[#55555E]" : "text-[#9A9AA3]"
                }`}>{s.label}</span>
              </div>
              {i < stages.length - 1 && (
                <span
                  className="h-[2px] w-8 mt-[-14px] rounded"
                  style={{ backgroundColor: done ? "#0F8A4B" : "#EDEDF0" }}
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
  icon: Icon, label, count, description, action, tone = "neutral", onAction,
}: {
  icon: any; label: string; count: number; description?: string;
  action?: string; tone?: Tone; onAction?: () => void;
}) {
  const t = TONE[tone];
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-[#F4F4F6] last:border-0 hover:bg-[#FAFAFB] transition-colors">
      <div className="h-9 w-9 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: t.bg, color: t.fg }}>
        <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[#111114] truncate">{label}</div>
        {description && <div className="text-[11px] text-[#55555E] mt-0.5 truncate">{description}</div>}
      </div>
      <div className="text-[16px] font-semibold text-[#111114] tabular-nums shrink-0">{count}</div>
      {onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-[12px] text-[#55555E] hover:text-[#CC0000] transition-colors shrink-0"
        >
          {action ?? "View"} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ---- Readiness summary --------------------------------------------------

export type Readiness = {
  status: "ready" | "almost" | "not_ready";
  label: string;
  blockers: string[];
  positives: string[];
  missing: string[];
  nextAction?: string;
};

export function ReadinessSummary({
  readiness, score, primary,
}: {
  readiness: Readiness; score?: number | null; primary?: ReactNode;
}) {
  const statusColor =
    readiness.status === "ready" ? { bg: "rgba(15,138,75,0.08)", fg: "#0F8A4B" }
    : readiness.status === "almost" ? { bg: "rgba(183,121,0,0.08)", fg: "#B77900" }
    : { bg: "rgba(204,0,0,0.08)", fg: "#CC0000" };
  return (
    <section className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm overflow-hidden">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-[#EDEDF0]">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: statusColor.bg, color: statusColor.fg }}
        >
          {readiness.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#111114]">Driver Readiness</div>
          {typeof score === "number" && (
            <div className="text-[11px] text-[#9A9AA3] mt-0.5">Signal score {score}/100</div>
          )}
        </div>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#EDEDF0]">
        <div className="p-5">
          <MicroLabel className="mb-2">Blockers</MicroLabel>
          {readiness.blockers.length === 0 && readiness.missing.length === 0 ? (
            <div className="text-[12px] text-[#9A9AA3]">None — ready to proceed.</div>
          ) : (
            <ul className="space-y-1.5">
              {readiness.blockers.map((b, i) => (
                <li key={`b${i}`} className="flex items-start gap-2 text-[12px] text-[#111114]">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#CC0000] shrink-0" />{b}
                </li>
              ))}
              {readiness.missing.map((m, i) => (
                <li key={`m${i}`} className="flex items-start gap-2 text-[12px] text-[#55555E]">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#C4C4CB] shrink-0" />{m} <span className="text-[#9A9AA3]">(missing info)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="p-5">
          <MicroLabel className="mb-2">Positive Signals</MicroLabel>
          {readiness.positives.length === 0 ? (
            <div className="text-[12px] text-[#9A9AA3]">No positive signals recorded yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {readiness.positives.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-[#111114]">
                  <Check className="w-3.5 h-3.5 mt-0.5 text-[#0F8A4B] shrink-0" strokeWidth={2.5} />{p}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {(readiness.nextAction || primary) && (
        <footer className="flex items-center justify-between gap-3 px-5 py-3.5 bg-[#FAFAFB] border-t border-[#EDEDF0]">
          <div className="min-w-0">
            <MicroLabel>Recommended Next</MicroLabel>
            <div className="text-[12px] text-[#111114] mt-0.5 truncate">{readiness.nextAction ?? "—"}</div>
          </div>
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

export function Timeline({ steps, title = "Rental Timeline" }: { steps: TimelineStep[]; title?: string }) {
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
                  style={{ backgroundColor: done ? "#0F8A4B" : "#EDEDF0" }}
                />
              )}
              <span
                className={`absolute left-0 top-0.5 h-6 w-6 rounded-full grid place-items-center border-2 ${
                  done
                    ? "border-transparent"
                    : cur
                    ? "border-[#CC0000] bg-white"
                    : "border-[#EDEDF0] bg-white"
                }`}
                style={done ? { backgroundColor: "#0F8A4B" } : undefined}
              >
                {done ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.5} /> :
                  cur ? <span className="h-2 w-2 rounded-full bg-[#CC0000]" /> :
                  <span className="h-1.5 w-1.5 rounded-full bg-[#D6D6DB]" />}
              </span>
              <div className="flex items-baseline justify-between gap-3">
                <div className={`text-[13px] font-medium ${done || cur ? "text-[#111114]" : "text-[#9A9AA3]"}`}>
                  {s.label}
                </div>
                {s.timestamp && (
                  <div className="text-[11px] text-[#9A9AA3] tabular-nums shrink-0">{s.timestamp}</div>
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
  const screeningDone = ["approved","interview_completed","interview_complete","complete","interview_done"].some(k => scrStatus.includes(k));
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
    if (!currentSet) { currentSet = true; return "current"; }
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
    if (!currentSet) { currentSet = true; return "current"; }
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