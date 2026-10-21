import { RENT_CATEGORIES, type RentReconciliationReport } from "./rent-reconciliation";

/**
 * Read-only tiles for one Eastern Time week.
 * A section whose source is not on this branch, or whose read failed, is "Not available".
 * Receivables Aging, Deposit Ledger, and the 4-week forecast are not in this stack.
 * summarizeFleet exists, but nothing on this branch exports a fleet-status read, so utilization stays unavailable.
 */

export const NOT_AVAILABLE = "Not available";

export const SNAPSHOT_TILES = [
  { id: "rent_collected", label: "Rent Collected", screen: "Payments", tab: "payments" },
  { id: "outstanding_balance", label: "Outstanding Balance", screen: null, tab: null },
  { id: "deposits_held", label: "Deposits Held", screen: null, tab: null },
  { id: "refunds_due", label: "Refunds Due", screen: null, tab: null },
  { id: "reconciliation_exceptions", label: "Reconciliation Exceptions", screen: "Rent Reconciliation", tab: "rent_reconciliation" },
  { id: "revenue_forecast", label: "4-Week Forecast", screen: null, tab: null },
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

export function buildOwnerFinanceSnapshot(input: {
  week: { from: string; through: string } | null;
  rentCollectedCents: number | null;
  exceptionCount: number | null;
}): OwnerFinanceSnapshotReport {
  const values: Record<SnapshotTileId, string> = {
    rent_collected: moneyOrUnavailable(input.rentCollectedCents),
    outstanding_balance: NOT_AVAILABLE,
    deposits_held: NOT_AVAILABLE,
    refunds_due: NOT_AVAILABLE,
    reconciliation_exceptions: countOrUnavailable(input.exceptionCount),
    revenue_forecast: NOT_AVAILABLE,
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

function moneyOrUnavailable(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents) || cents < 0) return NOT_AVAILABLE;
  return formatSnapshotMoney(cents);
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
