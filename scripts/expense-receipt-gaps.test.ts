import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPENSE_RECEIPT_GAPS_ENABLED } from "../src/lib/expense-receipt-gaps-flag";
import {
  EXPENSE_RECEIPT_GAP_LIMIT,
  MISSING_RECEIPT_PATH_OR,
  MISSING_RECEIPTS_UNREAD,
  easternGapWindow,
  easternLedgerRange,
  easternMonth,
  formatExpenseAmount,
  monthLabel,
  receiptOnFile,
  summarizeReceiptGaps,
} from "../src/lib/expense-receipt-gaps";

describe("missing receipt gaps", () => {
  it("keeps the flag off", () => {
    expect(EXPENSE_RECEIPT_GAPS_ENABLED).toBe(false);
  });

  it("treats a blank receipt path as missing and a stored path as on file", () => {
    expect(receiptOnFile(null)).toBe(false);
    expect(receiptOnFile("")).toBe(false);
    expect(receiptOnFile("  ")).toBe(false);
    expect(receiptOnFile("receipts/oil.pdf")).toBe(true);
    expect(MISSING_RECEIPT_PATH_OR).toBe(
      'receipt_path.is.null,receipt_path.eq.,receipt_path.match."^[[:space:]]+$"',
    );
  });

  it("uses the Eastern month around midnight", () => {
    expect(easternMonth(new Date("2026-10-01T03:30:00Z"))).toBe("2026-09");
    expect(easternMonth(new Date("2026-10-01T04:30:00Z"))).toBe("2026-10");
    const october = easternGapWindow("this_month", new Date("2026-10-21T16:00:00Z"));
    expect(october).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    const three = easternGapWindow("last_3", new Date("2026-10-21T16:00:00Z"));
    expect(three).toEqual({ from: "2026-08-01", to: "2026-11-01" });
    expect(easternGapWindow("all", new Date("2026-10-21T16:00:00Z"))).toEqual({ from: null, to: null });
    const ledger = easternLedgerRange("this_month", new Date("2026-10-21T16:00:00Z"));
    expect(ledger).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(easternLedgerRange("all", new Date("2026-10-21T16:00:00Z"))).toEqual({ from: null, to: null });
  });

  it("counts missing receipts by month and category and skips a path that is on file", () => {
    const summary = summarizeReceiptGaps([
      { category: "repair", incurredOn: "2026-10-04", receiptPath: null },
      { category: "repair", incurredOn: "2026-10-18", receiptPath: "  " },
      { category: "fuel", incurredOn: "2026-09-02", receiptPath: "" },
      { category: "insurance", incurredOn: "2026-10-09", receiptPath: "receipts/ins.pdf" },
      { category: " ", incurredOn: "not-a-date", receiptPath: null },
    ]);
    expect(summary).toEqual({
      capped: false,
      total: 4,
      counts: [
        { month: "2026-10", category: "repair", count: 2 },
        { month: "2026-09", category: "fuel", count: 1 },
        { month: "unknown", category: "unknown", count: 1 },
      ],
    });
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("unknown")).toBe("Unknown");
  });

  it("withholds the count when the read is one past the cap", () => {
    const rows = Array.from({ length: EXPENSE_RECEIPT_GAP_LIMIT }, (_, index) => ({
      category: "repair",
      incurredOn: "2026-10-01",
      receiptPath: null,
    }));
    expect(summarizeReceiptGaps(rows).capped).toBe(false);
    expect(summarizeReceiptGaps([...rows, rows[0]!]).capped).toBe(true);
  });

  it("does not turn a blank amount into zero", () => {
    expect(formatExpenseAmount(null)).toBe("Not Recorded");
    expect(formatExpenseAmount("")).toBe("Not Recorded");
    expect(formatExpenseAmount(-1)).toBe("Not Recorded");
    expect(formatExpenseAmount("1.005")).toBe("Not Recorded");
    expect(formatExpenseAmount(0)).toBe("$0.00");
    expect(formatExpenseAmount("80.50")).toBe("$80.50");
  });

  it("refuses before the manager check and before the read", () => {
    const source = readFileSync(new URL("../src/lib/expense-receipt-gaps.functions.ts", import.meta.url), "utf8");
    const gate = source.indexOf("if (!EXPENSE_RECEIPT_GAPS_ENABLED) throw new Error(EXPENSE_RECEIPT_GAPS_OFF);");
    const role = source.indexOf("await requireManager(context.userId)");
    const read = source.indexOf('.from("vehicle_expenses")');
    expect(gate).toBeGreaterThan(-1);
    expect(role).toBeGreaterThan(gate);
    expect(read).toBeGreaterThan(role);
    expect(source).toContain(".limit(EXPENSE_RECEIPT_GAP_LIMIT + 1)");
    expect(source).toContain(".or(MISSING_RECEIPT_PATH_OR)");
    expect(source).toContain("throw new Error(MISSING_RECEIPTS_UNREAD)");
    expect(MISSING_RECEIPTS_UNREAD).toBe("Missing receipts could not be read.");
    expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    const panel = readFileSync(new URL("../src/components/admin/ExpensesPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("receiptGaps={EXPENSE_RECEIPT_GAPS_ENABLED}");
    expect(panel).not.toContain("function MissingReceiptLedger");
    expect(panel).toContain("Missing Receipt");
    expect(panel).toContain("setRows([])");
    expect(panel).toContain("setGaps(null)");
    expect(panel).toContain("easternLedgerRange");
    const allClear = panel.indexOf('title="No Missing Receipts"');
    const readyEmpty = panel.lastIndexOf('gaps?.status === "ready" && gaps.rows.length === 0', allClear);
    expect(readyEmpty).toBeGreaterThan(-1);
    expect(panel.indexOf("showGaps && gapError")).toBeGreaterThan(-1);
    expect(panel.indexOf("showGaps && gapError")).toBeLessThan(allClear);
    const monthRangeStart = panel.indexOf("function monthRange");
    const monthRange = panel.slice(monthRangeStart, panel.indexOf("const PERIODS", monthRangeStart));
    expect(monthRange).toContain("getFullYear");
    expect(monthRange).toContain("toISOString");
    expect(monthRange).not.toContain("America/New_York");
    expect(panel).not.toMatch(/text-transform|uppercase/);
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).toContain('tab === "expenses" && <ExpensesPanel');
    expect(admin).not.toContain("expense_receipt");
    expect(
      readdirSync(new URL("../supabase/migrations", import.meta.url)).some((name) => name.includes("receipt-gap")),
    ).toBe(false);
  });
});
