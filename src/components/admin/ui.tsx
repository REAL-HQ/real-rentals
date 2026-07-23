import type { ReactNode } from "react";
import { Check } from "lucide-react";

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