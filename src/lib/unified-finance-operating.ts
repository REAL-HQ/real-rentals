import type { FinanceReport, Measure } from "./unified-finance";
import { decimalSourceCents } from "./unified-finance-live-mapping";
import { calendarDate } from "./unified-finance-vehicles";

/**
 * Operating Expenses from vehicle_expenses and maintenance company share.
 * A row counts only when it is dated inside the half-open window, the amount
 * is exact cents, and it is allocated to a vehicle. There is no company-level
 * expense table, so a blank vehicle id is unallocated.
 * A service and its linked expense are one movement: company share is not
 * added on top of that expense. Share left at 0 uses the linked expense.
 * A positive share that disagrees with the linked expense blanks the card.
 * Customer compensation has no credit ledger and no compensation-note source.
 */

const WAIVED = new Set(["rent", "late_fee", "other", "toll", "damage", "fee"]);

export const COMPENSATION_GAPS = ["No Customer Credit Source", "No Compensation Notes"] as const;

export type OperatingExpenseRow = {
  id: string;
  vehicleId: string | null;
  amount: string | number | null;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
};
export type OperatingMaintenanceRow = {
  id: string;
  vehicleId: string | null;
  companyShare: string | number | null;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};
export type WaivedFeeRow = {
  id: string;
  status: string | null;
  type: string | null;
  amount: string | number | null;
  paidDate: string | null;
  dueDate: string | null;
};

export type OperatingCounts = {
  undatedExpenses: number;
  unallocatedExpenses: number;
  inexactExpenses: number;
  undatedMaintenance: number;
  unallocatedMaintenance: number;
  inexactMaintenance: number;
  conflictingMaintenance: number;
  undatedWaivedFees: number;
  inexactWaivedFees: number;
};

export type OperatingAssessment = {
  expenseCents: number | null;
  expensesComplete: boolean;
  counts: OperatingCounts;
  reasons: string[];
  gaps: string[];
};

const emptyCounts = (): OperatingCounts => ({
  undatedExpenses: 0, unallocatedExpenses: 0, inexactExpenses: 0,
  undatedMaintenance: 0, unallocatedMaintenance: 0, inexactMaintenance: 0, conflictingMaintenance: 0,
  undatedWaivedFees: 0, inexactWaivedFees: 0,
});

function placed(candidates: (string | null | undefined)[]): { date: string | null; blocking: boolean } {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const date = calendarDate(candidate);
    return date ? { date, blocking: false } : { date: null, blocking: true };
  }
  return { date: null, blocking: true };
}

function allocated(vehicleId: string | null | undefined): boolean {
  return !!vehicleId?.trim();
}

function add(total: number, amount: number): number | null {
  const next = total + amount;
  return Number.isSafeInteger(next) ? next : null;
}

export function assessOperating(input: {
  period: { from: string; to: string };
  expenses: OperatingExpenseRow[];
  maintenance: OperatingMaintenanceRow[];
  waivedFees: WaivedFeeRow[];
}): OperatingAssessment {
  const counts = emptyCounts();
  const inWindow = (date: string) => date >= input.period.from && date < input.period.to;
  let blocked = false;
  let total = 0;
  const block = () => { blocked = true; };
  const linked = new Map<string, OperatingExpenseRow[]>();
  for (const expense of input.expenses) {
    if (!expense.maintenanceRecordId) continue;
    const rows = linked.get(expense.maintenanceRecordId) ?? [];
    rows.push(expense);
    linked.set(expense.maintenanceRecordId, rows);
  }

  const take = (amount: number) => {
    const next = add(total, amount);
    if (next === null) block();
    else total = next;
  };

  for (const expense of input.expenses) {
    if (expense.maintenanceRecordId) continue;
    const place = placed([expense.incurredOn]);
    if (place.blocking || !place.date) { counts.undatedExpenses += 1; block(); continue; }
    if (!inWindow(place.date)) continue;
    if (!allocated(expense.vehicleId)) { counts.unallocatedExpenses += 1; block(); continue; }
    const amount = decimalSourceCents(expense.amount);
    if (amount === null) { counts.inexactExpenses += 1; block(); continue; }
    take(amount);
  }

  const seenMaintenance = new Set(input.maintenance.map((record) => record.id));
  for (const [recordId, rows] of linked) {
    if (seenMaintenance.has(recordId)) continue;
    counts.conflictingMaintenance += rows.length;
    block();
  }

  for (const record of input.maintenance) {
    const place = placed([record.performedOn, record.completedAt, record.createdAt]);
    const links = linked.get(record.id) ?? [];
    const linkPlaces = links.map((expense) => ({ expense, place: placed([expense.incurredOn]) }));
    for (const item of linkPlaces) {
      if (item.place.blocking || !item.place.date) { counts.undatedExpenses += 1; block(); }
    }
    if (place.blocking || !place.date) { counts.undatedMaintenance += 1; block(); continue; }
    const maintenanceInside = inWindow(place.date);
    const expensesInside = linkPlaces.filter((item) => item.place.date !== null && inWindow(item.place.date));
    if (!maintenanceInside && expensesInside.length === 0) continue;
    if (maintenanceInside && !allocated(record.vehicleId)) { counts.unallocatedMaintenance += 1; block(); continue; }
    const unallocatedLinks = expensesInside.filter((item) => !allocated(item.expense.vehicleId)).length;
    if (unallocatedLinks) { counts.unallocatedExpenses += unallocatedLinks; block(); continue; }
    const share = decimalSourceCents(record.companyShare);
    const expenseAmounts = expensesInside.map((item) => decimalSourceCents(item.expense.amount));
    if (maintenanceInside && share === null) { counts.inexactMaintenance += 1; block(); continue; }
    if (expenseAmounts.some((amount) => amount === null)) { counts.inexactExpenses += 1; block(); continue; }
    const linkedCents = (expenseAmounts as number[]).reduce((sum, amount) => sum + amount, 0);
    if (!Number.isSafeInteger(linkedCents)) { counts.inexactExpenses += 1; block(); continue; }
    if (expensesInside.length === 0) { take(share ?? 0); continue; }
    if (!maintenanceInside) { take(linkedCents); continue; }
    if (share === 0 || share === linkedCents) { take(share === 0 ? linkedCents : share); continue; }
    counts.conflictingMaintenance += 1;
    block();
  }

  for (const fee of input.waivedFees) {
    if (fee.status !== "waived" || fee.type === "deposit") continue;
    if (!WAIVED.has(fee.type ?? "")) { counts.inexactWaivedFees += 1; continue; }
    const place = placed([fee.paidDate, fee.dueDate]);
    if (place.blocking || !place.date) { counts.undatedWaivedFees += 1; continue; }
    if (!inWindow(place.date)) continue;
    if (decimalSourceCents(fee.amount) === null) counts.inexactWaivedFees += 1;
  }

  const reasons: string[] = [];
  if (counts.undatedExpenses) reasons.push(`${counts.undatedExpenses} Undated Expenses`);
  if (counts.unallocatedExpenses) reasons.push(`${counts.unallocatedExpenses} Unallocated Expenses`);
  if (counts.inexactExpenses) reasons.push(`${counts.inexactExpenses} Inexact Expenses`);
  if (counts.undatedMaintenance) reasons.push(`${counts.undatedMaintenance} Undated Maintenance`);
  if (counts.unallocatedMaintenance) reasons.push(`${counts.unallocatedMaintenance} Unallocated Maintenance`);
  if (counts.inexactMaintenance) reasons.push(`${counts.inexactMaintenance} Inexact Maintenance`);
  if (counts.conflictingMaintenance) reasons.push(`${counts.conflictingMaintenance} Conflicting Maintenance`);
  if (counts.undatedWaivedFees) reasons.push(`${counts.undatedWaivedFees} Undated Waived Fees`);
  if (counts.inexactWaivedFees) reasons.push(`${counts.inexactWaivedFees} Inexact Waived Fees`);
  const expensesComplete = !blocked && Number.isSafeInteger(total);
  return {
    expenseCents: expensesComplete ? total : null,
    expensesComplete,
    counts,
    reasons,
    gaps: [...COMPENSATION_GAPS],
  };
}

const unknown = (): Measure => ({ value: null, complete: false });

/** Operating Result is Net Collections minus Operating Expenses, and only when both cards are complete. */
export function applyOperatingCards(report: FinanceReport, operating: OperatingAssessment): FinanceReport {
  const operatingExpenses: Measure = operating.expensesComplete && operating.expenseCents !== null
    ? { value: operating.expenseCents, complete: true }
    : unknown();
  const net = report.netCollections;
  const operatingResult: Measure = net.complete && net.value !== null && operatingExpenses.complete && operatingExpenses.value !== null
    && Number.isSafeInteger(net.value - operatingExpenses.value)
    ? { value: net.value - operatingExpenses.value, complete: true }
    : unknown();
  return { ...report, operatingExpenses, operatingResult, customerCompensation: unknown() };
}
