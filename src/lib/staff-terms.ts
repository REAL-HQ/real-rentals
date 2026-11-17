/**
 * Terms Confirmed (Move Forward), Dolmar Nov 17 2026. Client-safe helpers.
 *
 * After Rosa (or another manager) calls an approved applicant and goes over
 * the terms, she clicks Move Forward on the Terms Confirmed row of the Next
 * Step card. The server stores one staff_terms_confirmations event per
 * applicant and term set and queues the FLEET webhook
 * applicant_ready_for_agreement; FLEET then sends the agreement through
 * POST /api/public/fleet/send-agreement with channel "staff".
 *
 * Presentation only: this row is never an activation gate.
 */
import type { ActivationRequirement } from "@/lib/activation-readiness";

export const STAFF_TERMS_TABLE = "staff_terms_confirmations";
export const STAFF_TERMS_EVENT = "applicant_ready_for_agreement" as const;
export const MOVE_FORWARD_LABEL = "Move Forward";
export const TERMS_CONFIRMED_LABEL = "Terms Confirmed";

/**
 * reservation_fee is the Reservation Fee the agreement prints and signing
 * charges (applied to week 1; never a deposit). deposit is the per-car
 * security deposit, 0 today, kept for a future rental that takes one
 * (Dolmar, Nov 17 10:36 AM). The deposit key keeps its meaning for FLEET.
 */
export type StaffTerms = { weekly_rate: number; reservation_fee: number; deposit: number; start_date: string; vehicle_id: string };

export type StaffTermsDelivery = "sent" | "sending" | "failed" | "none";

/** What the profile reads to draw the row. */
export type StaffTermsState = {
  /** Tables not set up yet (migration not applied). */
  ready: boolean;
  latest: null | {
    id: string;
    clickedAt: string;
    clickedByName: string;
    terms: StaffTerms & { vehicle_label: string | null };
    delivery: StaffTermsDelivery;
    deliveredAt: string | null;
    error: string | null;
  };
  /** What the agreement would print today; prefills the dialog. */
  prefill: (Partial<StaffTerms> & { vehicle_label?: string | null }) | null;
  blockers: { field: string; label: string; why: string }[];
};

function money(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate what staff confirmed in the dialog. */
export function parseStaffTerms(raw: any): { ok: true; value: StaffTerms } | { ok: false; error: string } {
  const weekly = money(raw?.weekly_rate);
  if (weekly === null || weekly <= 0) return { ok: false, error: "Weekly Rate must be a positive amount." };
  const reservation = money(raw?.reservation_fee);
  if (reservation === null) return { ok: false, error: "Reservation must be an amount (0 if none)." };
  const deposit = raw?.deposit == null || raw?.deposit === "" ? 0 : money(raw?.deposit);
  if (deposit === null) return { ok: false, error: "Deposit must be an amount (0 if none)." };
  const start = String(raw?.start_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(`${start}T12:00:00Z`))) return { ok: false, error: "Start Date must be a date." };
  const vehicle = String(raw?.vehicle_id ?? "").trim();
  if (!UUID.test(vehicle)) return { ok: false, error: "Choose the vehicle." };
  return { ok: true, value: { weekly_rate: weekly, reservation_fee: reservation, deposit, start_date: start, vehicle_id: vehicle.toLowerCase() } };
}

/** One key per term set: the same click twice is the same event. */
export function staffTermsKey(t: StaffTerms): string {
  return [t.weekly_rate.toFixed(2), t.reservation_fee.toFixed(2), t.deposit.toFixed(2), t.start_date, t.vehicle_id.toLowerCase()].join("|");
}

/** Short Eastern time, e.g. "Nov 17, 10:05 AM". */
export function shortEt(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t));
}

/** Webhook row status -> what the row says. */
export function deliveryState(row: { status?: string | null } | null | undefined): StaffTermsDelivery {
  const s = String(row?.status ?? "");
  if (s === "delivered") return "sent";
  if (s === "pending") return "sending";
  if (s === "failed" || s === "skipped") return "failed";
  return "failed";
}

/**
 * The Terms Confirmed row. Always shown in the Next Step list, right after
 * Application Approved (Dolmar, Nov 17 12:09 PM): "After Approval" (grey) until
 * the application is approved, then "Not Done" until Move Forward is clicked,
 * then "Confirmed By <name>, <time> · Sent To FLEET", or "Failed" (with Retry).
 * Already complete once an agreement is signed.
 */
export const TERMS_AFTER_APPROVAL = "After Approval";
export function termsConfirmedRequirement(state: StaffTermsState | null | undefined, opts: { approved: boolean; agreementSigned: boolean }): ActivationRequirement {
  const latest = state?.latest ?? null;
  let detail = "Not Done";
  let met: boolean | null = false;
  const who = latest ? [latest.clickedByName ? `Confirmed By ${latest.clickedByName}` : "Confirmed", shortEt(latest.clickedAt)].filter(Boolean).join(", ") : "";
  if (latest?.delivery === "sent") { detail = `${who} · Sent To FLEET`; met = true; }
  else if (latest?.delivery === "sending") detail = `${who} · Sending To FLEET`;
  else if (latest) detail = "Failed";
  else if (opts.agreementSigned) { detail = "Agreement Signed"; met = true; }
  else if (!opts.approved) { detail = TERMS_AFTER_APPROVAL; met = null; }
  return { key: "terms_confirmed", label: TERMS_CONFIRMED_LABEL, met, enforcement: "advisory", detail };
}

/** Button enabled only after approval, for managers, while no agreement is signed. */
export function moveForwardEnabled(opts: { approved: boolean; isManager: boolean; agreementSigned: boolean; busy?: boolean }): boolean {
  return opts.approved && opts.isManager && !opts.agreementSigned && !opts.busy;
}
