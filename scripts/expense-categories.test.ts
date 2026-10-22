import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { railEntries, visibleTabs } from "../src/components/admin/nav-config";
import {
  EXPENSE_ONCE_NOTE,
  buildExpenseCategorySummary,
  expenseCategoriesToCsv,
  type ExpenseCategoryRow,
} from "../src/lib/expense-categories";
import { FINANCE_EXPENSE_CATEGORIES_ENABLED } from "../src/lib/expense-categories-flag";
import { loadExpenseCategories, runExpenseCategories } from "../src/lib/expense-categories.server";

/**
 * October 2026, Eastern Time.
 *   insurance 2026-10-09   $45.00
 *   repair    2026-10-04  $180.00
 *   tires     2026-10-11   $25.50
 *   insurance 2026-09-01   $10.00  outside the month, ignored
 *   repair    2026-09-02   bad amount, ignored because it is outside the window
 *   Total                 $250.50
 */

const NOW = new Date("2026-10-21T16:00:00.000Z");

const row = (extra: Partial<ExpenseCategoryRow> & { id: string }): ExpenseCategoryRow => ({
  vehicleId: "veh-1",
  category: "other",
  amount: "0.00",
  incurredOn: "2026-10-06",
  ...extra,
});

function october(): ExpenseCategoryRow[] {
  return [
    row({ id: "e-ins", category: "insurance", amount: "45.00", incurredOn: "2026-10-09" }),
    row({ id: "e-repair", category: "repair", amount: "180.00", incurredOn: "2026-10-04" }),
    row({
      id: "e-tires",
      category: "tires",
      amount: "25.50",
      incurredOn: "2026-10-11",
      vehicleId: "veh-2",
    }),
    row({ id: "e-old", category: "insurance", amount: "10.00", incurredOn: "2026-09-01" }),
    row({ id: "e-old-bad", category: "repair", amount: "not-money", incurredOn: "2026-09-02" }),
  ];
}

describe("expense categories", () => {
  it("groups October expenses once by category", () => {
    const summary = buildExpenseCategorySummary({
      expenses: october(),
      period: "this_month",
      now: NOW,
    });
    expect(summary?.complete).toBe(true);
    expect(summary?.coverage).toBe("complete");
    expect(summary?.from).toBe("2026-10-01");
    expect(summary?.to).toBe("2026-11-01");
    expect(summary?.lines).toEqual([
      { category: "insurance", label: "Insurance", count: 1, cents: 4500 },
      { category: "repair", label: "Repair", count: 1, cents: 18000 },
      { category: "tires", label: "Tires", count: 1, cents: 2550 },
    ]);
    expect(summary?.count).toBe(3);
    expect(summary?.totalCents).toBe(25050);
    expect(summary?.notes).toEqual([EXPENSE_ONCE_NOTE]);
    expect(expenseCategoriesToCsv(summary!)).toContain("Insurance,1,4500");
    expect(expenseCategoriesToCsv(summary!)).toContain("Total,3,25050");
  });

  it("names a blank category Uncategorized", () => {
    const summary = buildExpenseCategorySummary({
      expenses: [row({ id: "e-blank", category: "  ", amount: "5.00" })],
      period: "this_month",
      now: NOW,
    });
    expect(summary?.lines).toEqual([
      { category: "uncategorized", label: "Uncategorized", count: 1, cents: 500 },
    ]);
  });

  it("withholds an in-window amount that cannot be read", () => {
    const summary = buildExpenseCategorySummary({
      expenses: [row({ id: "e-bad", amount: "12.345", incurredOn: "2026-10-04" })],
      period: "this_month",
      now: NOW,
    });
    expect(summary?.complete).toBe(false);
    expect(summary?.coverage).toBe("unavailable");
    expect(summary?.totalCents).toBeNull();
    expect(summary?.lines).toEqual([]);
    expect(summary?.notes.join(" ")).toContain("withheld");
  });

  it("withholds a repeated expense id", () => {
    const summary = buildExpenseCategorySummary({
      expenses: [row({ id: "e-1", amount: "5.00" }), row({ id: "e-1", amount: "5.00" })],
      period: "this_month",
      now: NOW,
    });
    expect(summary?.complete).toBe(false);
    expect(summary?.totalCents).toBeNull();
  });

  it("fails closed when a date cannot be placed", () => {
    const summary = buildExpenseCategorySummary({
      expenses: [row({ id: "e-date", incurredOn: "10/04/2026", amount: "5.00" })],
      period: "this_month",
      now: NOW,
    });
    expect(summary?.complete).toBe(false);
    expect(summary?.totalCents).toBeNull();
  });
});

describe("expense categories access", () => {
  it("stays off and does not read", async () => {
    expect(FINANCE_EXPENSE_CATEGORIES_ENABLED).toBe(false);
    const flag = readFileSync(
      new URL("../src/lib/expense-categories-flag.ts", import.meta.url),
      "utf8",
    );
    expect(flag).toMatch(/export const FINANCE_EXPENSE_CATEGORIES_ENABLED = false/);
    expect(flag.match(/FINANCE_EXPENSE_CATEGORIES_ENABLED\s*=/g)).toHaveLength(1);
    expect(flag).not.toMatch(/process\.env/);
    const handler = readFileSync(
      new URL("../src/lib/expense-categories.functions.ts", import.meta.url),
      "utf8",
    );
    const gate = handler.indexOf("if (!FINANCE_EXPENSE_CATEGORIES_ENABLED) return DISABLED");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf('await import("@/lib/roles.server")'));
    expect(gate).toBeLessThan(handler.indexOf('"./expense-categories.server"'));
    expect(handler).not.toMatch(/import type \{ ExpenseCategoriesResponse \} from "\.\/expense-categories\.server"/);
    const sources = [
      "src/lib/expense-categories.ts",
      "src/lib/expense-categories.server.ts",
      "src/lib/expense-categories.functions.ts",
      "src/components/admin/nav-config.ts",
      "src/routes/admin.tsx",
      "src/lib/session-isolation.ts",
    ];
    for (const path of sources) {
      const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/export const FINANCE_EXPENSE_CATEGORIES_ENABLED/);
    }
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).toMatch(
      /FINANCE_EXPENSE_CATEGORIES_ENABLED && tab === "expense_categories" && \(?\s*<ExpenseCategoriesPanel \/>/,
    );
    expect(visibleTabs("owner").some((tab) => tab.id === "expense_categories")).toBe(false);
    expect(visibleTabs("manager").some((tab) => tab.id === "expense_categories")).toBe(false);
    const rail = railEntries("owner")
      .map((entry) => entry.label)
      .join(",");
    expect(rail).toBe(
      "Overview,Drivers,Bookings,Active Rentals,Payments,Vehicles,Fleet Inbox,Service,Incidents,Driver Issues,Expenses,Partners",
    );
    expect(rail).not.toContain("Expense Categories");
    const isolation = readFileSync(
      new URL("../src/lib/session-isolation.ts", import.meta.url),
      "utf8",
    );
    expect(isolation).not.toContain("FINANCE_EXPENSE_CATEGORIES_ENABLED");
    const load = vi.fn();
    await expect(
      runExpenseCategories({
        enabled: false,
        userId: "owner-1",
        tier: "owner",
        period: "this_month",
        now: NOW,
        load,
      }),
    ).resolves.toEqual({ status: "disabled", summary: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a coordinator before the read", async () => {
    const load = vi.fn();
    await expect(
      runExpenseCategories({
        enabled: true,
        userId: "coord-1",
        tier: "coordinator",
        period: "this_month",
        now: NOW,
        load,
      }),
    ).rejects.toThrow("Forbidden");
    expect(load).not.toHaveBeenCalled();
  });

  it("selects vehicle expenses and does not write", async () => {
    const calls: string[] = [];
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      gt: () => query,
      abortSignal: () => query,
      then: (resolve: (value: { data: []; error: null }) => void) => {
        resolve({ data: [], error: null });
      },
    };
    const supabase = {
      from: (table: string) => {
        calls.push(table);
        return query;
      },
    };
    const rows = await loadExpenseCategories(supabase as never);
    expect(rows).toEqual([]);
    expect(calls).toEqual(["vehicle_expenses", "vehicle_expenses"]);
    const server = readFileSync(
      new URL("../src/lib/expense-categories.server.ts", import.meta.url),
      "utf8",
    );
    expect(server).toContain('select("id,vehicle_id,category,amount,incurred_on")');
    expect(server).not.toMatch(/maintenance_records|company_share|partner_share/);
    expect(server).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(calls).not.toContain("maintenance_records");
  });
});
