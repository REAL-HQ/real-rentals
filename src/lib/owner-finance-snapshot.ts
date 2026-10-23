import { AGE_BUCKETS } from "./receivables-aging";
import { RENT_CATEGORIES, type RentReconciliationReport } from "./rent-reconciliation";

/**
 * Read-only tiles for one Eastern Time week.
 * A section whose read failed, or whose totals were withheld, is "Not available".
 * Outstanding Balance is the sum of the Receivables Aging buckets.
 * Deposits Held and Refunds Due are the Deposit Ledger totals.
 * 4-Week Forecast is the Revenue Forecast total, which is projected income, not collected money.
 * summarizeFleet exists, but no exported reader supplies fleet rows, so utilization stays unavailable.
 */

export const NOT_AVAILABLE = "Not available";

export const SNAPSHOT_TILES = [
  { id: "rent_collected", label: "Rent Collected", screen: "Payments", tab: "payments" },
  { id: "outstanding_balance", label: "Outstanding Balance", screen: "Receivables Aging", tab: "receivables_aging" },
  { id: "deposits_held", label: "Deposits Held", screen: "Deposit Ledger", tab: "deposit_ledger" },
  { id: "refunds_due", label: "Refunds Due", screen: "Deposit Ledger", tab: "deposit_ledger" },
  { id: "reconciliation_exceptions", label: "Reconciliation Exceptions", screen: "Rent Reconciliation", tab: "rent_reconciliation" },
  { id: "revenue_forecast", label: "4-Week Forecast", screen: "Revenue Forecast", tab: "revenue_forecast" },
  { id: "vehicle_utilization", label: "Vehicle Utilization", screen: null, tab: null },
] as const;

export type SnapshotTileId = (typeof SNAPSHOT_TILES)[number]["id"];

export type SnapshotTile = {
  id: SnapshotTileId;
  label: string;
  value: string;
  screen: string | null;
  tab: string | null;
};

export type OwnerFinanceSnapshotReport = {
  from: string | null;
  through: string | null;
  tiles: SnapshotTile[];
};

export function formatSnapshotMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Non-matched rows, and only when the reconciliation read finished with Stripe ready and totals present. */
export function reconciliationExceptionCount(report: RentReconciliationReport): number | null {
  if (report.stripeCheck !== "ready" || report.totals == null || report.warnings.length > 0) return null;
  let count = 0;
  for (const category of RENT_CATEGORIES) {
    if (category === "matched") continue;
    const part = report.totals[category];
    if (!part || !Number.isSafeInteger(part.count) || part.count < 0) return null;
    count += part.count;
  }
  return count;
}

/** Sum of the aging buckets. A warning or a withheld total stays unavailable. */
export function outstandingBalanceCents(report: { warnings: readonly string[]; bucketCents: Partial<Record<string, number>> | null } | null): number | null {
  if (!report || report.warnings.length > 0 || !report.bucketCents) return null;
  let total = 0;
  for (const bucket of AGE_BUCKETS) {
    const cents = report.bucketCents[bucket];
    if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0) return null;
    total += cents;
  }
  return Number.isSafeInteger(total) ? total : null;
}

/** Deposit Ledger held total. A warning or a withheld total stays unavailable. Stripe evidence does not change it. */
export function depositsHeldCents(report: { warnings: readonly string[]; heldCents: number | null } | null): number | null {
  if (!report || report.warnings.length > 0) return null;
  return wholeCents(report.heldCents);
}

/** Deposit Ledger refunds due in the next 7 days. A warning or a withheld total stays unavailable. */
export function refundsDueCents(report: { warnings: readonly string[]; dueBackCents: number | null } | null): number | null {
  if (!report || report.warnings.length > 0) return null;
  return wholeCents(report.dueBackCents);
}

/** Four-week projected total. A warning withholds it, including the forecast page cap. */
export function forecastTotalCents(report: { warnings: readonly string[]; totalCents: number } | null): number | null {
  if (!report || report.warnings.length > 0) return null;
  return wholeCents(report.totalCents);
}

export function buildOwnerFinanceSnapshot(input: {
  week: { from: string; through: string } | null;
  rentCollectedCents: number | null;
  exceptionCount: number | null;
  outstandingCents?: number | null;
  depositsHeldCents?: number | null;
  refundsDueCents?: number | null;
  forecastCents?: number | null;
}): OwnerFinanceSnapshotReport {
  const values: Record<SnapshotTileId, string> = {
    rent_collected: moneyOrUnavailable(input.rentCollectedCents),
    outstanding_balance: moneyOrUnavailable(input.outstandingCents ?? null),
    deposits_held: moneyOrUnavailable(input.depositsHeldCents ?? null),
    refunds_due: moneyOrUnavailable(input.refundsDueCents ?? null),
    reconciliation_exceptions: countOrUnavailable(input.exceptionCount),
    revenue_forecast: moneyOrUnavailable(input.forecastCents ?? null),
    vehicle_utilization: NOT_AVAILABLE,
  };
  return {
    from: input.week?.from ?? null,
    through: input.week?.through ?? null,
    tiles: SNAPSHOT_TILES.map((tile) => ({ ...tile, value: values[tile.id] })),
  };
}

export function ownerFinanceSnapshotToCsv(report: OwnerFinanceSnapshotReport): string {
  const lines: string[][] = [
    ["Owner Weekly Finance Snapshot"],
    ["Week Starting", report.from ?? ""],
    ["Week Ending", report.through ?? ""],
    ["Eastern Time"],
    [],
    ["Tile", "Value", "Screen"],
    ...report.tiles.map((tile) => [tile.label, tile.value, tile.screen ?? ""]),
  ];
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function wholeCents(cents: number | null): number | null {
  if (cents == null || !Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

function moneyOrUnavailable(cents: number | null): string {
  const whole = wholeCents(cents);
  if (whole == null) return NOT_AVAILABLE;
  return formatSnapshotMoney(whole);
}

function countOrUnavailable(count: number | null): string {
  if (count == null || !Number.isSafeInteger(count) || count < 0) return NOT_AVAILABLE;
  return String(count);
}

function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
