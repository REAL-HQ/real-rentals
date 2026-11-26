/**
 * t374u / t375u / t376u: Payments column sort, Charges filter chips,
 * and the Current overdue pill. No production data.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ariaSortValue,
  compareSortValues,
  cycleColumnSort,
  isBlankSortValue,
  sortRows,
} from "../src/lib/admin-table-sort";
import { countsAsOwed, isZeroMoneyRow, rowOwed } from "../src/lib/payments-summary";

describe("column sort helpers", () => {
  test("first click uses firstDir, second flips, third clears", () => {
    const first = cycleColumnSort(null, "due", "desc");
    expect(first).toEqual({ key: "due", dir: "desc" });
    const second = cycleColumnSort(first, "due", "desc");
    expect(second).toEqual({ key: "due", dir: "asc" });
    const third = cycleColumnSort(second, "due", "desc");
    expect(third).toBeNull();
  });

  test("clicking a different column starts at that column's firstDir", () => {
    const due = cycleColumnSort(null, "due", "desc");
    expect(cycleColumnSort(due, "driver", "asc")).toEqual({ key: "driver", dir: "asc" });
  });

  test("text is case-insensitive and blanks / em-dashes sort last in both directions", () => {
    const rows = ["zeta", "—", "Alpha", "", null, "beta"];
    const asc = sortRows(rows, (r) => r, "text", "asc");
    const desc = sortRows(rows, (r) => r, "text", "desc");
    expect(asc.slice(0, 3)).toEqual(["Alpha", "beta", "zeta"]);
    expect(asc.slice(3)).toEqual(["—", "", null]);
    expect(desc.slice(0, 3)).toEqual(["zeta", "beta", "Alpha"]);
    expect(desc.slice(3)).toEqual(["—", "", null]);
  });

  test("numbers compare numerically, not as strings", () => {
    const rows = [9, 100, 20, 3];
    expect(sortRows(rows, (r) => r, "number", "asc")).toEqual([3, 9, 20, 100]);
    expect(sortRows(rows, (r) => r, "number", "desc")).toEqual([100, 20, 9, 3]);
    expect(compareSortValues("$1,050", "$90", "number", "asc")).toBeGreaterThan(0);
  });

  test("dates compare chronologically and missing dates stay last", () => {
    const rows = ["2026-11-16", "", "2026-10-31", null, "2026-11-02"];
    expect(sortRows(rows, (r) => r, "date", "asc")).toEqual(["2026-10-31", "2026-11-02", "2026-11-16", "", null]);
    expect(sortRows(rows, (r) => r, "date", "desc")).toEqual(["2026-11-16", "2026-11-02", "2026-10-31", "", null]);
  });

  test("equal values keep their original order", () => {
    const rows = [
      { id: "a", amount: 350 },
      { id: "b", amount: 350 },
      { id: "c", amount: 50 },
    ];
    expect(sortRows(rows, (r) => r.amount, "number", "asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  test("blank detection and aria-sort values", () => {
    expect(isBlankSortValue("—")).toBe(true);
    expect(isBlankSortValue("  ")).toBe(true);
    expect(isBlankSortValue(0)).toBe(false);
    expect(ariaSortValue(false, "asc")).toBe("none");
    expect(ariaSortValue(true, "desc")).toBe("descending");
    expect(ariaSortValue(true, "asc")).toBe("ascending");
  });
});

describe("Payments / Charges / Bookings wiring", () => {
  const payments = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
  const charges = readFileSync("src/components/admin/ChargesPanel.tsx", "utf8");
  const rentals = readFileSync("src/components/admin/ActiveRentalsPanel.tsx", "utf8");
  const overdue = readFileSync("src/components/admin/OverdueStatus.tsx", "utf8");
  const header = readFileSync("src/components/admin/SortableColumnHeader.tsx", "utf8");

  test("Payments headers are sortable, Outstanding uses the filtered set, default is due earliest", () => {
    for (const key of ["driver", "vehicle", "type", "amount", "due", "status", "method", "late_fees", "balance"]) {
      expect(payments).toContain(`"${key}"`);
    }
    expect(payments).toContain("SortableColumnHeader");
    expect(payments).toContain("cycleColumnSort");
    expect(payments).toContain('PAYMENT_FIRST_DIR');
    expect(payments).toContain('due: "desc"');
    expect(payments).toContain('sortRows(filtered, (p) => p.due_date || "", "date", "asc")');
    expect(payments).toContain("const totalDue = filtered");
    expect(payments).toContain("isZeroMoneyRow");
    expect(payments).toContain("ledgerPayments");
    expect(payments).toContain("sorted.map((p)");
    expect(payments.includes("data-admin-flow")).toBe(false);
  });

  test("sortable header exposes aria-sort and an arrow on the active column", () => {
    expect(header).toContain("aria-sort");
    expect(header).toContain("ArrowUp");
    expect(header).toContain("ArrowDown");
  });

  test("Charges filter chips sit inside the sticky bar and are not pulled under its paint", () => {
    expect(charges).toContain('data-admin-flow');
    expect(charges).toContain('data-testid="charges-status-filters"');
    const toolbarOpen = charges.indexOf('data-testid="charges-toolbar"');
    const chipsIdx = charges.indexOf('data-testid="charges-status-filters"');
    const afterToolbar = charges.indexOf("{loading ?", toolbarOpen);
    expect(toolbarOpen).toBeGreaterThan(0);
    expect(charges.slice(toolbarOpen - 80, toolbarOpen)).toContain("data-admin-flow");
    expect(charges.slice(toolbarOpen - 80, toolbarOpen + 80)).toContain("admin-sticky-bar");
    expect(chipsIdx).toBeGreaterThan(toolbarOpen);
    expect(afterToolbar).toBeGreaterThan(chipsIdx);
    expect(charges).toContain("flex flex-wrap gap-1.5");
    for (const label of ["All", "Unassigned", "Ready To Bill", "Billed", "Paid", "Disputed", "Written Off"]) {
      expect(charges).toContain(`label: "${label}"`);
    }
  });

  test("Current uses the green success pill; overdue stays the red pill of the same size", () => {
    expect(rentals).toContain("<OverdueStatus days={row.overdueDays} due={row.nextPaymentDue} today={today} />");
    expect(rentals).toContain(">Status</th>");
    expect(overdue).toContain('data-testid="overdue-due-pill"');
    expect(overdue).toContain("bg-[#FFF4D6]");
    expect(rentals).not.toContain("overdueLabel(");
    expect(overdue).toContain('data-testid="overdue-current-pill"');
    expect(overdue).toContain("rgba(80,192,96,0.08)");
    expect(overdue).toContain("#50C060");
    expect(overdue).toContain("rounded-full");
    expect(overdue).toContain("px-2 py-0.5 text-[11px] font-semibold");
    expect(overdue).toContain("DANGER_BADGE");
  });

  test("a $0 invoice is hidden and does not change Outstanding", () => {
    const rent = { id: "rent", type: "rent", status: "current", amount: 350, balance_due: 350 };
    const paused = { id: "zero", type: "rent", status: "paid", amount: 0, balance_due: 0 };
    const paidDown = { id: "paid", type: "rent", status: "paid", amount: 350, balance_due: 0 };
    expect(isZeroMoneyRow(paused)).toBe(true);
    expect(isZeroMoneyRow(paidDown)).toBe(false);
    expect(isZeroMoneyRow(rent)).toBe(false);
    const covered = new Set<string>();
    const all = [rent, paused, paidDown];
    const visible = all.filter((p) => !isZeroMoneyRow(p));
    const outstanding = (rows: typeof all) => rows.filter((p) => countsAsOwed(p, covered)).reduce((s, p) => s + rowOwed(p), 0);
    expect(outstanding(all)).toBe(350);
    expect(outstanding(visible)).toBe(350);
    expect(visible.map((p) => p.id)).toEqual(["rent", "paid"]);
  });
});
