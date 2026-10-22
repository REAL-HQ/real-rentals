/**
 * Application Status vocabulary and the rules the Drivers list shares with
 * the server.
 *
 * Closed already exists (`applications.status = 'closed'`, the Closed filter,
 * and historical rows). This file does not rename it.
 *
 * Approved is already an allowed database value. The latest check constraint,
 * `applications_status_check` in
 * supabase/migrations/20260727033224_68c459f8-788b-4264-a625-e06290c01d49.sql,
 * includes 'approved'. No migration and no flag are required to offer it.
 * Choosing Approved still goes through approveApplication. This module never
 * writes status 'approved' or 'active'.
 *
 * Active is not an application status anyone can pick. A driver is Active
 * only when existing rows already show an ongoing rental, a real assigned
 * vehicle in their possession, a collected initial payment, and a recorded
 * handover. Approval and Stripe subscription status are ignored. Nothing
 * here inserts a driver, rental, payment, or vehicle.
 *
 * Record Rental stays disabled. RECORD_RENTAL_CONTRACT_ENABLED is false
 * because the Record Rental database contracts (#190 / #191 / #181) are not
 * installed. This read does not call those RPCs and does not manufacture
 * the rows the definition requires.
 *
 * Ending a rental still closes the application inside the installed
 * end_rental_tx. That write is proposed, not applied: see
 * proposed/end-rental-preserves-application-v1.sql and
 * END_RENTAL_PRESERVES_APPLICATION_ENABLED.
 *
 * Closure reason and notes are stored on the existing audit_log row
 * (actor, timestamp, metadata). applications has no closure column, and
 * this path does not add one. Lead source, contact history, and the
 * application's own notes column are not written.
 */

import type { StaffTier } from "@/lib/roles";

export const APPLICATION_STATUS_CHOICES = [
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "approved", label: "Approved" },
  { value: "suspended", label: "Suspended" },
  { value: "declined", label: "Declined" },
  { value: "closed", label: "Closed" },
] as const;

export type ApplicationStatusChoice = (typeof APPLICATION_STATUS_CHOICES)[number]["value"];

/** Statuses a person can type into the lifecycle writer. Approved and Active are absent. */
export const LIFECYCLE_STATUS_VALUES = ["new", "reviewing", "suspended", "declined", "closed"] as const;

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewing: "Reviewing",
  approved: "Approved",
  suspended: "Suspended",
  declined: "Declined",
  closed: "Closed",
  active: "Active",
  partial: "Partial",
  complete: "Complete",
  duplicate: "Duplicate",
};

export function applicationStatusLabel(value: string | null | undefined): string {
  const key = String(value ?? "").trim();
  if (!key) return "Select Status";
  return APPLICATION_STATUS_LABELS[key] ?? key;
}

/**
 * Menu for one row. Active is included only when the stored status is already
 * Active, and then it is disabled so it cannot be selected.
 */
export function applicationStatusMenu(current: string | null | undefined): {
  value: string;
  label: string;
  disabled: boolean;
}[] {
  const menu: { value: string; label: string; disabled: boolean }[] = APPLICATION_STATUS_CHOICES.map(
    (choice) => ({
      value: choice.value,
      label: choice.label,
      disabled: false,
    }),
  );
  const stored = String(current ?? "").trim();
  if (stored && !menu.some((choice) => choice.value === stored)) {
    menu.unshift({
      value: stored,
      label: applicationStatusLabel(stored),
      disabled: stored === "active",
    });
  }
  return menu;
}

export const CLOSURE_REASONS = [
  { key: "unable_to_qualify", label: "Unable to Qualify" },
  { key: "no_vehicle_available", label: "No Vehicle Available" },
  { key: "pricing_affordability", label: "Pricing / Affordability" },
  { key: "applicant_withdrew", label: "Applicant Withdrew" },
  { key: "unresponsive", label: "Unresponsive" },
  { key: "other", label: "Other" },
] as const;

export type ClosureReason = (typeof CLOSURE_REASONS)[number]["key"];

export const CLOSURE_REASON_KEYS = CLOSURE_REASONS.map((reason) => reason.key) as [
  ClosureReason,
  ...ClosureReason[],
];

const CLOSURE_LABELS: Record<string, string> = Object.fromEntries(
  CLOSURE_REASONS.map((reason) => [reason.key, reason.label]),
);

export function normalizeClosureReason(value: unknown): ClosureReason | null {
  const key = String(value ?? "").trim();
  return (CLOSURE_REASON_KEYS as readonly string[]).includes(key) ? (key as ClosureReason) : null;
}

export function closureReasonLabel(value: unknown): string {
  const key = normalizeClosureReason(value);
  return key ? CLOSURE_LABELS[key] : "";
}

/** Owner and Manager. A Coordinator can close; reopening a Closed row is not theirs. */
export function canReopenClosedApplication(tier: StaffTier): boolean {
  return tier === "owner" || tier === "manager";
}

export type ApplicationStatusEvent = {
  at: string;
  actor: string | null;
  action: "closed" | "reopened";
  reason: ClosureReason | null;
  reasonLabel: string | null;
  notes: string | null;
  previousStatus: string | null;
  status: string | null;
};

export function applicationStatusEventFromAudit(row: {
  created_at: unknown;
  actor_email: unknown;
  action: unknown;
  metadata: unknown;
}): ApplicationStatusEvent | null {
  const action =
    row.action === "application.closed"
      ? "closed"
      : row.action === "application.reopened"
        ? "reopened"
        : null;
  if (!action) return null;
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const reason = normalizeClosureReason(metadata.closure_reason);
  const rawNotes = typeof metadata.closure_notes === "string" ? metadata.closure_notes.trim() : "";
  return {
    at: String(row.created_at ?? ""),
    actor: row.actor_email ? String(row.actor_email) : null,
    action,
    reason,
    reasonLabel: reason ? closureReasonLabel(reason) : null,
    notes: rawNotes ? rawNotes : null,
    previousStatus: typeof metadata.previous_status === "string" ? metadata.previous_status : null,
    status: typeof metadata.status === "string" ? metadata.status : null,
  };
}

const TERMINAL_RENTAL = new Set([
  "ended",
  "completed",
  "closed",
  "returned",
  "finished",
  "cancelled",
  "canceled",
]);

/** Collected charge types that count as the initial payment. Not a subscription status. */
export const INITIAL_PAYMENT_TYPES = ["rent", "deposit"] as const;

export type ActiveRentalRow = {
  id: string;
  application_id: string | null;
  status: string | null;
  vehicle_id: string | null;
  pickup_reading_id: string | null;
};

export type ActiveVehicleRow = {
  id: string;
  status: string | null;
  archived_at: string | null;
};

export type ActivePaymentRow = {
  rental_id: string | null;
  status: string | null;
  type: string | null;
  net_collected: number | string | null;
  amount: number | string | null;
};

function money(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function initialPaymentReceived(payment: ActivePaymentRow): boolean {
  if (!payment.rental_id) return false;
  if (String(payment.status ?? "") !== "paid") return false;
  if (!(INITIAL_PAYMENT_TYPES as readonly string[]).includes(String(payment.type ?? ""))) return false;
  const net = money(payment.net_collected);
  const collected = net == null ? money(payment.amount) : net;
  return collected != null && collected > 0;
}

/**
 * Application ids that meet the Active definition. Duplicates collapse to one
 * id. Rows that are only approved, or that only have a subscription, are
 * absent because those facts are not inputs.
 */
export function authoritativeActiveApplicationIds(input: {
  rentals: readonly ActiveRentalRow[];
  vehicles: readonly ActiveVehicleRow[];
  payments: readonly ActivePaymentRow[];
}): string[] {
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const paidRentals = new Set(
    input.payments.filter(initialPaymentReceived).map((payment) => payment.rental_id as string),
  );
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rental of input.rentals) {
    const status = String(rental.status ?? "").toLowerCase();
    if (status !== "active" || TERMINAL_RENTAL.has(status)) continue;
    if (!rental.application_id || seen.has(rental.application_id)) continue;
    if (!rental.vehicle_id || !rental.pickup_reading_id) continue;
    const vehicle = vehicles.get(rental.vehicle_id);
    if (!vehicle || vehicle.archived_at) continue;
    if (String(vehicle.status ?? "").toLowerCase() !== "rented") continue;
    if (!paidRentals.has(rental.id)) continue;
    seen.add(rental.application_id);
    ids.push(rental.application_id);
  }
  return ids;
}

/** Rentals still in the installed `active` status, whether or not Active evidence is complete. */
export function openRentalApplicationIds(rentals: readonly ActiveRentalRow[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rental of rentals) {
    if (String(rental.status ?? "").toLowerCase() !== "active") continue;
    if (!rental.application_id || seen.has(rental.application_id)) continue;
    seen.add(rental.application_id);
    ids.push(rental.application_id);
  }
  return ids;
}

export function applicationFilterCount(
  key: string,
  drivers: readonly { id: string; status: string | null }[],
  held: ReadonlySet<string>,
  activeIds: ReadonlySet<string>,
  waitlistCount: number | null,
): number | null {
  if (key === "waitlist") {
    if (waitlistCount == null) return null;
    return waitlistCount + drivers.filter((driver) => held.has(driver.id)).length;
  }
  if (key === "all") return drivers.length;
  if (key === "active") return drivers.filter((driver) => activeIds.has(driver.id)).length;
  return drivers.filter((driver) => driver.status === key && !held.has(driver.id)).length;
}
