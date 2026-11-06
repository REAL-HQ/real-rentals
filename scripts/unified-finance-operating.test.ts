import { describe, expect, it } from "vitest";
import { summarizeFinance } from "../src/lib/unified-finance";
import { applyOperatingCards, assessOperating, type OperatingExpenseRow, type OperatingMaintenanceRow, type WaivedFeeRow } from "../src/lib/unified-finance-operating";

const period = { from: "2026-10-01", to: "2026-11-01" };
const expense = (overrides: Partial<OperatingExpenseRow> = {}): OperatingExpenseRow => ({
  id: "exp-1", vehicleId: "veh-1", amount: 10, incurredOn: "2026-10-10", maintenanceRecordId: null, ...overrides,
});
const maintenance = (overrides: Partial<OperatingMaintenanceRow> = {}): OperatingMaintenanceRow => ({
  id: "mnt-1", vehicleId: "veh-1", companyShare: 4, performedOn: "2026-10-20", completedAt: null, createdAt: "2026-10-20T15:00:00Z", ...overrides,
});

function assessed(overrides: { expenses?: OperatingExpenseRow[]; maintenance?: OperatingMaintenanceRow[]; waivedFees?: WaivedFeeRow[] } = {}) {
  return assessOperating({ period, expenses: overrides.expenses ?? [], maintenance: overrides.maintenance ?? [], waivedFees: overrides.waivedFees ?? [] });
}

function withNet(cents: number) {
  return summarizeFinance({
    events: [{ id: "col-1", kind: "collection", amountCents: cents, feeCents: 0, currency: "USD", status: "succeeded", cashDate: "2026-10-15", evidence: "verified", method: "cash" }],
    period, basis: "cash", currency: "USD", coverage: "complete",
  });
}

describe("operating expenses", () => {
  it("adds an allocated expense and company share, then subtracts them from net collections", () => {
    const operating = assessed({ expenses: [expense()], maintenance: [maintenance()] });
    expect(operating.expensesComplete).toBe(true);
    expect(operating.expenseCents).toBe(1400);
    const report = applyOperatingCards(withNet(10000), operating);
    expect(report.operatingExpenses).toEqual({ value: 1400, complete: true });
    expect(report.operatingResult).toEqual({ value: 8600, complete: true });
    expect(report.customerCompensation).toEqual({ value: null, complete: false });
    expect(operating.gaps).toEqual(["No Customer Credit Source", "No Compensation Notes"]);
  });

  it("counts a linked service expense once when company share is zero or the same amount", () => {
    const zeroShare = assessed({
      expenses: [expense({ amount: 10, maintenanceRecordId: "mnt-1" })],
      maintenance: [maintenance({ companyShare: 0 })],
    });
    expect(zeroShare.expensesComplete).toBe(true);
    expect(zeroShare.expenseCents).toBe(1000);
    const same = assessed({
      expenses: [expense({ amount: 4, maintenanceRecordId: "mnt-1" })],
      maintenance: [maintenance({ companyShare: 4 })],
    });
    expect(same.expenseCents).toBe(400);
  });

  it("blanks the card and counts rows that are undated, unallocated, inexact, or conflicting", () => {
    const undated = assessed({ expenses: [expense({ incurredOn: null })] });
    expect(undated.expensesComplete).toBe(false);
    expect(undated.expenseCents).toBeNull();
    expect(undated.counts.undatedExpenses).toBe(1);
    expect(JSON.stringify(applyOperatingCards(withNet(10000), undated).operatingExpenses)).not.toContain("1000");

    const unallocated = assessed({ expenses: [expense({ vehicleId: null })] });
    expect(unallocated.counts.unallocatedExpenses).toBe(1);
    expect(unallocated.expenseCents).toBeNull();

    const inexact = assessed({ expenses: [expense({ amount: 10.129 })] });
    expect(inexact.counts.inexactExpenses).toBe(1);
    expect(inexact.expenseCents).toBeNull();

    const conflict = assessed({
      expenses: [expense({ amount: 10, maintenanceRecordId: "mnt-1" })],
      maintenance: [maintenance({ companyShare: 4 })],
    });
    expect(conflict.counts.conflictingMaintenance).toBe(1);
    expect(conflict.expensesComplete).toBe(false);
    expect(applyOperatingCards(withNet(10000), conflict).operatingResult).toEqual({ value: null, complete: false });
  });

  it("ignores rows outside the window and leaves operating result blank when net collections is blank", () => {
    const outside = assessed({
      expenses: [expense({ incurredOn: "2026-11-01" })],
      maintenance: [maintenance({ performedOn: "2026-09-01", completedAt: null, createdAt: null })],
    });
    expect(outside.expensesComplete).toBe(true);
    expect(outside.expenseCents).toBe(0);
    const incompleteNet = summarizeFinance({ events: [], period, basis: "cash", currency: "USD", coverage: "incomplete" });
    const report = applyOperatingCards(incompleteNet, assessed({ expenses: [expense()] }));
    expect(report.operatingExpenses).toEqual({ value: 1000, complete: true });
    expect(report.operatingResult).toEqual({ value: null, complete: false });
  });

  it("counts an undated waived fee and does not treat a vendor credit or a deposit waiver as customer compensation", () => {
    const waived = assessed({ waivedFees: [
      { id: "fee-1", status: "waived", type: "late_fee", amount: 15, paidDate: null, dueDate: null },
      { id: "fee-2", status: "waived", type: "deposit", amount: 200, paidDate: null, dueDate: null },
      { id: "fee-3", status: "paid", type: "rent", amount: 80, paidDate: "2026-10-02", dueDate: null },
    ] });
    expect(waived.counts.undatedWaivedFees).toBe(1);
    expect(waived.gaps).toEqual(["No Customer Credit Source", "No Compensation Notes"]);
    expect(waived.expensesComplete).toBe(true);
  });
});
