// Collections: what a renter still owes after the rental ended (repossessed, or returned with a
// balance). Pure helpers shared by the Payments > Collections tab, the renter profile's
// Collections card and tests. The database (migration 20261122143000_collections.sql) is the
// source of truth for moves, proration and payments applied; this file only mirrors its rules
// for display. No database or Stripe access here.

export const COLLECTION_REASONS = [
  "unpaid_rent",
  "late_fees",
  "key_replacement",
  "damage",
  "tolls_tickets",
  "towing_repo",
  "cleaning",
  "other",
] as const;
export type CollectionReason = (typeof COLLECTION_REASONS)[number];

export const COLLECTION_REASON_LABEL: Record<CollectionReason, string> = {
  unpaid_rent: "Unpaid Rent",
  late_fees: "Late Fees",
  key_replacement: "Key Replacement",
  damage: "Damage",
  tolls_tickets: "Tolls & Tickets",
  towing_repo: "Towing/Repo",
  cleaning: "Cleaning",
  other: "Other",
};

export const COLLECTION_STATUSES = ["open", "payment_plan", "sent_to_collections", "paid", "settled", "written_off"] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const COLLECTION_STATUS_LABEL: Record<CollectionStatus, string> = {
  open: "Open",
  payment_plan: "Payment Plan",
  sent_to_collections: "Sent To Collections",
  paid: "Paid",
  settled: "Settled",
  written_off: "Written Off",
};

/** Badge tone per status: still owed is red/amber, closed is green/neutral. */
export const COLLECTION_STATUS_TONE: Record<CollectionStatus, "red" | "amber" | "green" | "neutral"> = {
  open: "red",
  payment_plan: "amber",
  sent_to_collections: "red",
  paid: "green",
  settled: "neutral",
  written_off: "neutral",
};

/** Statuses that still owe money and accept payments (collection_status_is_open in SQL). */
export const OPEN_COLLECTION_STATUSES: ReadonlySet<string> = new Set(["open", "payment_plan", "sent_to_collections"]);

export function isOpenCollectionStatus(status: string | null | undefined): boolean {
  return OPEN_COLLECTION_STATUSES.has(String(status ?? ""));
}

export function collectionReasonLabel(reason: string | null | undefined): string {
  return COLLECTION_REASON_LABEL[reason as CollectionReason] ?? "Other";
}

export function collectionStatusLabel(status: string | null | undefined): string {
  return COLLECTION_STATUS_LABEL[status as CollectionStatus] ?? "Open";
}

/**
 * The payments status a row gets when it moves to Collections. It is deliberately NOT part of the
 * Overdue filter, the Outstanding total, the late fee sweep, or any past-due/reminder text or email.
 */
export const IN_COLLECTIONS_PAYMENT_STATUS = "collections";

export type CollectionItemLike = {
  amount: number | string | null;
  amount_paid?: number | string | null;
  status: string | null;
};

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function collectionBalance(item: CollectionItemLike): number {
  if (!isOpenCollectionStatus(item.status)) return 0;
  return Math.max(0, r2(num(item.amount) - num(item.amount_paid)));
}

/** Total still owed across items (open statuses only). */
export function collectionsTotal(items: readonly CollectionItemLike[]): number {
  return r2(items.reduce((s, it) => s + collectionBalance(it), 0));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export type RepoProration = {
  /** Days the renter still had the car in the missed week: week start through repo date, inclusive (0..7). */
  days: number;
  dailyRate: number;
  weeklyRate: number;
  /** What the week owes after proration (never more than the original amount). */
  amount: number;
  originalAmount: number;
  /** False when the repo was on or after the 7th day: the full week is owed. */
  prorated: boolean;
};

/**
 * Same rule as public.collections_apply_proration: weekly rate / 7 x days the renter still had the
 * car, counted from the start of the missed week through the repo date. Late fees, keys, damage and
 * other charges are not prorated.
 */
export function prorateRepoWeek(input: { weeklyRate: number | null | undefined; originalAmount: number; weekStart: string; repoDate: string }): RepoProration {
  const original = r2(num(input.originalAmount));
  const days = Math.min(7, Math.max(0, daysBetween(input.weekStart, input.repoDate) + 1));
  const rate = num(input.weeklyRate) > 0 ? num(input.weeklyRate) : original;
  if (days >= 7) return { days: 7, dailyRate: r2(rate / 7), weeklyRate: rate, amount: original, originalAmount: original, prorated: false };
  const amount = Math.max(0, Math.min(original, r2((rate / 7) * days)));
  return { days, dailyRate: r2(rate / 7), weeklyRate: rate, amount, originalAmount: original, prorated: true };
}

/** Days late on the repo date, from the oldest unpaid rent week (same as record_rental_repossession). */
export function daysLateAtRepo(oldestUnpaidWeekStart: string | null | undefined, repoDate: string): number {
  if (!oldestUnpaidWeekStart) return 0;
  return Math.max(0, daysBetween(oldestUnpaidWeekStart, repoDate));
}

export type StoredProration = {
  weekly_rate?: number | string;
  daily_rate?: number | string;
  days?: number | string;
  prorated_amount?: number | string;
  original_amount?: number | string;
  week_start?: string;
  repo_date?: string;
  auto_settled?: boolean;
};

const usd = (v: number) => `$${v.toFixed(2)}`;

/** One line of proration math for an item, e.g. "$350.00/week ÷ 7 × 3 days = $150.00 (replaces $350.00)". */
export function prorationMath(p: StoredProration | null | undefined): string | null {
  if (!p || p.days == null) return null;
  const days = num(p.days);
  return `${usd(num(p.weekly_rate))}/week ÷ 7 × ${days} day${days === 1 ? "" : "s"} = ${usd(num(p.prorated_amount))} (replaces ${usd(num(p.original_amount))})`;
}

/** Path for an attachment in the private receipts bucket; add_collection_attachment checks the prefix. */
export function collectionAttachmentPath(itemId: string, fileName: string, now = Date.now()): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "file";
  return `collections/${itemId}/${now}-${safe}`;
}
