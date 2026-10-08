// Manual Payments — shared rules (browser-safe, pure).
// Mirrors the PROPOSED database functions (scripts/phase-c-manual-payments*.proposed.sql).
// The database stays the authority once applied; this module drives the gated
// preview UI and its tests. Nothing here writes data.

export const MANUAL_PAYMENTS_LIVE = false; // flips only after the DB foundation is approved + applied
export const PENDING_HOURS = 48;

export type Method = "cash_app" | "venmo" | "zelle" | "cash" | "bank_transfer" | "check" | "money_order" | "other";
export type Role = "owner" | "manager" | "coordinator" | "driver";
export type CollStatus = "pending" | "verified" | "rejected" | "reversed" | "expired";

export const METHOD_LABEL: Record<Method, string> = {
  cash_app: "Cash App", venmo: "Venmo", zelle: "Zelle", cash: "Cash",
  bank_transfer: "Bank Transfer", check: "Check", money_order: "Money Order", other: "Other",
};
export const STATUS_LABEL: Record<CollStatus, string> = {
  pending: "Pending Verification", verified: "Verified", rejected: "Rejected", reversed: "Reversed", expired: "Expired",
};

export type Charge = { id: string; amount: number; balance: number; status: string; stripeInProgress?: boolean };
export type AuditEntry = { at: string; actor: string; action: string; reason?: string };
export type Collection = {
  id: string; chargeId: string; method: Method; amount: number; receivedOn: string;
  reference?: string; hasReceipt: boolean; cashRecipient?: string; notes?: string;
  status: CollStatus; recordedBy: string; recordedAt: string; expiresAt: string;
  decidedBy?: string; selfException?: string; reason?: string; audit: AuditEntry[];
};

const CLOSED = new Set(["paid", "refunded", "waived", "void"]);
export const normRef = (r?: string) => (r ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") || null;
export const isLiveStatus = (c: Collection, now: Date) => c.status === "pending" && new Date(c.expiresAt) > now;

/** Reserved = live pending allocations (never reduce the real balance). */
export function reserved(chargeId: string, all: Collection[], now: Date, exceptId?: string) {
  return all.filter((c) => c.chargeId === chargeId && c.id !== exceptId && isLiveStatus(c, now)).reduce((s, c) => s + c.amount, 0);
}

export function canRecord(role: Role) { return role === "owner" || role === "manager" || role === "coordinator"; }
export function canDecide(role: Role) { return role === "owner" || role === "manager"; }

export type Input = { method: Method; amount: number; receivedOn: string; reference?: string; hasReceipt: boolean; cashRecipient?: string; notes?: string };

export function validateRecord(i: Input, charge: Charge, all: Collection[], role: Role, now: Date): string | null {
  if (!canRecord(role)) return "Not allowed to record payments";
  if (!(i.amount > 0)) return "Enter an amount above $0";
  if (i.receivedOn > now.toISOString().slice(0, 10)) return "Date received cannot be in the future";
  const ref = normRef(i.reference);
  if (["cash_app", "venmo", "zelle", "bank_transfer", "money_order"].includes(i.method) && !i.hasReceipt && !ref) return "Add a receipt or a transaction reference";
  if (i.method === "check" && !i.hasReceipt) return "Add a check image or deposit confirmation";
  if (i.method === "cash" && (!i.notes?.trim() || !i.cashRecipient?.trim())) return "Cash needs a written note and who received it";
  if (i.method === "other" && (!i.notes?.trim() || (!i.hasReceipt && !ref))) return "Other needs supporting evidence and an explanation";
  if (CLOSED.has(charge.status)) return `This charge is already ${charge.status}`;
  if (charge.stripeInProgress) return "A card payment is in progress for this charge";
  if (ref && all.some((c) => normRef(c.reference) === ref && c.method === i.method && c.status !== "rejected" && c.status !== "expired"))
    return "This reference was already recorded";
  const res = reserved(charge.id, all, now);
  if (i.amount > charge.balance - res + 0.0001) return `Amount is more than the remaining balance ($${charge.balance} open, $${res} already pending)`;
  return null;
}

export function validateVerify(c: Collection, charge: Charge, all: Collection[], role: Role, actor: string, fundsConfirmed: boolean, note: string, selfReason: string, now: Date): string | null {
  if (!canDecide(role)) return "Only a Manager or Owner can verify payments";
  if (c.status !== "pending") return `Payment record is ${STATUS_LABEL[c.status]}`;
  if (new Date(c.expiresAt) <= now) return "This pending payment has expired";
  if (!fundsConfirmed || !note.trim()) return "Confirm the money arrived and say how you checked (a screenshot alone is not proof)";
  if (c.method === "cash" && role !== "owner") return "Cash payments need Owner verification";
  if (c.recordedBy === actor) {
    if (role !== "owner") return "Another Manager or the Owner must verify a payment you recorded";
    if (!selfReason.trim() || (!c.hasReceipt && !c.reference && c.method !== "cash")) return "Verifying your own entry needs a written exception reason and supporting evidence";
  } else if (selfReason.trim()) return "Exception reason is only for verifying your own entry";
  if (CLOSED.has(charge.status)) return `This charge is already ${charge.status}`;
  // Atomic recheck: balance minus OTHER live reservations.
  if (c.amount > charge.balance - reserved(charge.id, all, now, c.id) + 0.0001) return `Amount is more than the remaining balance ($${charge.balance})`;
  return null;
}

export function validateReason(role: Role, c: Collection, want: CollStatus, reason: string): string | null {
  if (!canDecide(role)) return "Only a Manager or Owner can do this";
  if (!reason.trim()) return "A reason is required";
  if (c.status !== want) return `Payment record is ${STATUS_LABEL[c.status]}`;
  return null;
}

export function validateExtend(role: Role, c: Collection, reason: string, now: Date): string | null {
  if (role !== "owner") return "Only the Owner can extend a deadline";
  if (!reason.trim()) return "A reason is required";
  if (c.status !== "pending" && c.status !== "expired") return "Only pending or expired payments can be extended";
  void now;
  return null;
}

/** Expiry sweep: pending past deadline → expired. Releases reservation; no money moves. */
export function sweepExpired(all: Collection[], now: Date): Collection[] {
  return all.map((c) => c.status === "pending" && new Date(c.expiresAt) <= now
    ? { ...c, status: "expired", audit: [...c.audit, { at: now.toISOString(), actor: "system", action: "Expired (48-hour deadline passed)" }] }
    : c);
}

export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000).toISOString();
