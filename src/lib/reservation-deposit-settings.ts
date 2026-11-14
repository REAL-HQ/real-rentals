/** Client-safe parse rules for reservation deposit defaults (app_settings). */

export const RESERVATION_DEPOSIT_SETTINGS_KEY = "reservation_deposit";

export type ReservationDepositSettings = {
  /** Global Off/On. Missing/malformed = Off. */
  enabled: boolean;
  /** Prefill amount when On. */
  defaultAmount: number;
  /** When true, Start Rental is blocked while deposit is still pending. Default false. */
  blockStartWhenPending: boolean;
};

export const DEFAULT_RESERVATION_DEPOSIT_SETTINGS: ReservationDepositSettings = {
  enabled: false,
  defaultAmount: 0,
  blockStartWhenPending: false,
};

export function readReservationDepositSettings(value: unknown): ReservationDepositSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_RESERVATION_DEPOSIT_SETTINGS };
  }
  const v = value as Record<string, unknown>;
  const amount = Number(v.default_amount);
  return {
    enabled: v.enabled === true,
    defaultAmount: Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0,
    blockStartWhenPending: v.block_start_when_pending === true,
  };
}

export function writeReservationDepositSettings(s: ReservationDepositSettings): Record<string, unknown> {
  return {
    enabled: s.enabled === true,
    default_amount: Math.max(0, Math.round(Number(s.defaultAmount) * 100) / 100),
    block_start_when_pending: s.blockStartWhenPending === true,
  };
}

export const RESERVATION_DEPOSIT_STATUSES = [
  "not_required",
  "pending",
  "paid",
  "waived",
  "refunded",
  "applied",
] as const;
export type ReservationDepositStatus = (typeof RESERVATION_DEPOSIT_STATUSES)[number];

export const RESERVATION_DEPOSIT_STATUS_LABEL: Record<ReservationDepositStatus, string> = {
  not_required: "Not Required",
  pending: "Pending",
  paid: "Paid",
  waived: "Waived",
  refunded: "Refunded",
  applied: "Applied",
};

export function isReservationDepositStatus(v: unknown): v is ReservationDepositStatus {
  return (RESERVATION_DEPOSIT_STATUSES as readonly string[]).includes(String(v));
}

/** Resolve create-time deposit fields from global defaults + optional override. */
export function resolveReservationDeposit(input: {
  settings: ReservationDepositSettings;
  overrideRequired?: boolean | null;
  overrideAmount?: number | null;
}): { required: boolean; amount: number; status: ReservationDepositStatus } {
  const required =
    input.overrideRequired == null ? input.settings.enabled : input.overrideRequired === true;
  if (!required) return { required: false, amount: 0, status: "not_required" };
  const raw =
    input.overrideAmount == null ? input.settings.defaultAmount : Number(input.overrideAmount);
  const amount = Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0;
  if (!(amount > 0)) return { required: false, amount: 0, status: "not_required" };
  return { required: true, amount, status: "pending" };
}
