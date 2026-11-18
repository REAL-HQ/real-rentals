/** Presentation only: completion facts are supplied by existing authorized reads. */
export const DRIVER_LIFECYCLE_STAGES = [
  { key: "applied", label: "Applied" },
  { key: "contacted", label: "Contacted" },
  { key: "documents", label: "Documents" },
  { key: "screening", label: "Screening" },
  { key: "approved", label: "Approved" },
  { key: "agreement", label: "Agreement" },
  { key: "reserved", label: "Reserved" },
  { key: "insurance", label: "Insurance" },
  { key: "inspection", label: "Inspection" },
  { key: "pickup", label: "Pickup" },
  { key: "active", label: "Active" },
] as const;
export type DriverLifecycleKey = typeof DRIVER_LIFECYCLE_STAGES[number]["key"];
/**
 * "open": not complete, but a later stage is already done, so the applicant
 * has moved past it (for example FLEET approved before an income file or an
 * insurance quote arrived). It is never shown as checked and never counts
 * toward the percent; it only stops a non-gating stage from freezing the
 * header on "Next: Screening" for someone who is already Approved.
 */
export type DriverLifecycleStage = { key: DriverLifecycleKey; label: string; state: "done" | "current" | "upcoming" | "open" };

/**
 * Stages that do not gate the ones after them. Approved, Agreement,
 * Reserved, Inspection, Pickup and Active are real gates (activation and the
 * rental transaction enforce them), so they always stay the current step
 * until their own fact is true.
 */
export const NON_GATING_STAGES: readonly DriverLifecycleKey[] = ["contacted", "documents", "screening", "insurance"];

export function driverLifecycle(facts: {
  contacted: boolean; screening: boolean;
  approved: boolean; inspection: boolean; agreement: boolean; rentalActive: boolean;
  /** Existing reserved rental with confirmed pickup details; Active also completes this stage. */
  reserved?: boolean;
  /** Existing authorized insurance readiness; reservation or activation never verifies insurance. */
  insuranceComplete?: boolean;
  /** Saved staff pickup check-off (Yellow); Active still needs a real running rental. */
  pickup?: boolean;
  /** Aggregate receipt of license, gig-profile and income-proof files, not their verification. */
  documentsReceived?: boolean;
  /** Saved interview completion (driver_screenings.interview_completed_at). A
   *  finished call proves we reached them, so Contacted is done even when no
   *  contacted date was ever stamped. */
  interviewComplete?: boolean;
}) {
  const completed: Record<DriverLifecycleKey, boolean> = {
    applied: true,
    contacted: facts.contacted || facts.interviewComplete === true,
    documents: facts.documentsReceived === true,
    // Approval is the screening decision. Once staff or FLEET approved the
    // applicant (or they are at or past Approved), Screening is done even when
    // the optional insurance-quote / screening files were never uploaded.
    screening: facts.screening || facts.approved || facts.agreement || facts.rentalActive || facts.reserved === true,
    approved: facts.approved,
    agreement: facts.agreement,
    reserved: facts.rentalActive || facts.reserved === true,
    insurance: facts.insuranceComplete === true,
    inspection: facts.inspection,
    pickup: facts.rentalActive || facts.pickup === true,
    active: facts.rentalActive,
  };
  const keys = DRIVER_LIFECYCLE_STAGES.map((s) => s.key);
  const laterDone = (i: number) => keys.slice(i + 1).some((k) => k !== "applied" && completed[k]);
  let currentFound = false;
  const stages: DriverLifecycleStage[] = DRIVER_LIFECYCLE_STAGES.map(({ key, label }, i) => {
    if (completed[key]) return { key, label, state: "done" };
    if (!currentFound && NON_GATING_STAGES.includes(key) && laterDone(i)) return { key, label, state: "open" };
    if (!currentFound) { currentFound = true; return { key, label, state: "current" }; }
    return { key, label, state: NON_GATING_STAGES.includes(key) && laterDone(i) ? "open" : "upcoming" };
  });
  const current = stages.find((stage) => stage.state === "current") ?? stages[stages.length - 1];
  return {
    stages,
    current,
    /** Non-gating stages the applicant moved past without completing (shown amber, unchecked). */
    open: stages.filter((stage) => stage.state === "open"),
    percent: Math.round(stages.filter((stage) => stage.state === "done").length / stages.length * 100),
  };
}

/** One lead_activity row, as getLeadActivity returns it. */
export type ContactActivity = { activity_type?: string | null; direction?: string | null; status?: string | null; occurred_at?: string | null };

const FAILED_DELIVERY = /^(failed|undelivered|error|bounced|rejected|cancell?ed|queued|pending|skipped)$/i;
/** Contact Status values that mean nobody has reached out yet. */
const NOT_CONTACTED_STATUSES = new Set(["", "new"]);

/**
 * When the applicant was first contacted, from real records only:
 *   - contacted_at (staff "Mark Contacted", approval, or FLEET after a two-way exchange),
 *   - a Contact Status other than New (staff logged a call, voicemail or follow-up),
 *   - a screening row past New Lead, or
 *   - a delivered outbound text or a call (staff, FLEET or an automation such as the
 *     missing-items message), or any inbound text or call from the applicant.
 * Automatic emails (the application resume link) do not count: every applicant
 * gets one, so they prove nothing. A missing screening row is not "contacted"
 * (the old check read a blank status as past New Lead and checked Contacted for
 * applicants nobody had reached).
 */
export function firstContact(input: {
  contactedAt?: string | null;
  contactStatus?: string | null;
  contactStatusAt?: string | null;
  screeningStatus?: string | null;
  activity?: readonly ContactActivity[] | null;
}): { contacted: boolean; at: string | null; via: "contacted_at" | "contact_status" | "screening" | "text_or_call" | null } {
  const candidates: { at: string | null; via: "contacted_at" | "contact_status" | "screening" | "text_or_call" }[] = [];
  if (input.contactedAt) candidates.push({ at: input.contactedAt, via: "contacted_at" });
  const cs = String(input.contactStatus ?? "").trim().toLowerCase();
  if (!NOT_CONTACTED_STATUSES.has(cs)) candidates.push({ at: input.contactStatusAt ?? null, via: "contact_status" });
  const scr = String(input.screeningStatus ?? "").trim().toLowerCase();
  if (scr && scr !== "new_lead") candidates.push({ at: null, via: "screening" });
  for (const row of input.activity ?? []) {
    const type = String(row.activity_type ?? "").toLowerCase();
    const dir = String(row.direction ?? "").toLowerCase();
    if (!["text", "call", "voicemail"].includes(type)) continue;
    if (dir === "outbound" && FAILED_DELIVERY.test(String(row.status ?? "").trim())) continue;
    if (dir !== "outbound" && dir !== "inbound") continue;
    candidates.push({ at: row.occurred_at ?? null, via: "text_or_call" });
  }
  if (!candidates.length) return { contacted: false, at: null, via: null };
  const dated = candidates.filter((c) => c.at && Number.isFinite(Date.parse(c.at))).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const first = dated[0] ?? candidates[0]!;
  return { contacted: true, at: first.at, via: first.via };
}

/**
 * When the current stage started: the latest known completion time of a done
 * stage before it, falling back to the application date. The old header used
 * the application date for every stage, so "4h in stage" on Documents was
 * really "4h since applying".
 */
export function stageStartedAt(
  stages: readonly DriverLifecycleStage[],
  current: DriverLifecycleKey | undefined,
  doneAt: Partial<Record<DriverLifecycleKey, string | null | undefined>>,
): string | null {
  const idx = stages.findIndex((s) => s.key === current);
  const before = idx < 0 ? stages : stages.slice(0, idx);
  let best: number | null = null;
  for (const s of before) {
    if (s.state !== "done") continue;
    const t = Date.parse(String(doneAt[s.key] ?? ""));
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  if (best !== null) return new Date(best).toISOString();
  return doneAt.applied ?? null;
}

/** FLEET's lifecycle audit rows, as getFleetLifecycleMarks returns them. */
export type FleetLifecycleMark = { step: DriverLifecycleKey; at: string; summary: string };
/** Latest FLEET mark per stage, for the "By FLEET" caption. */
export function fleetMarksByStage(marks: readonly FleetLifecycleMark[] | null | undefined): Partial<Record<DriverLifecycleKey, FleetLifecycleMark>> {
  const out: Partial<Record<DriverLifecycleKey, FleetLifecycleMark>> = {};
  for (const m of marks ?? []) {
    const prev = out[m.step];
    if (!prev || Date.parse(m.at) > Date.parse(prev.at)) out[m.step] = m;
  }
  return out;
}

/**
 * Reserved is done only when the $50 Reservation Fee is actually paid (a
 * successful payment recorded), or the rental is already running. An open
 * reservation row alone never turns it green while a fee is still owed,
 * refunded or pending. A reservation staff made with no fee required
 * (fee off or waived) still counts, as before.
 */
export function reservationStageDone(input: {
  feeStatus: string | null | undefined;
  hasReservation: boolean;
  feeRequired?: boolean;
  rentalActive?: boolean;
}): boolean {
  if (input.rentalActive === true) return true;
  const status = String(input.feeStatus ?? "");
  if (status === "paid") return true;
  if (status === "waived") return input.hasReservation;
  if (status !== "") return false; // pending, unpaid, refunded, failed: not reserved yet
  return input.hasReservation && input.feeRequired !== true;
}
