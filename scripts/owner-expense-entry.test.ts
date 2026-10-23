import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { railEntries, visibleTabs } from "../src/components/admin/nav-config";
import { OWNER_EXPENSE_ENTRY_ENABLED } from "../src/lib/owner-expense-entry-flag";
import { ownerExpenseInsert, type OwnerExpenseDraft } from "../src/lib/owner-expense-entry";
import { runCreateOwnerExpense } from "../src/lib/owner-expense-entry.server";

const OWNER = "11111111-1111-4111-8111-111111111111";
const VEHICLE = "22222222-2222-4222-8222-222222222222";
const VENDOR = "33333333-3333-4333-8333-333333333333";

function draft(amount: number | string = "25.50"): OwnerExpenseDraft {
  return {
    vehicleId: VEHICLE,
    incurredOn: "2026-10-21",
    amount,
    category: "repair",
    vendorId: null,
    description: "Brake pads",
    notes: "Front axle",
  };
}

describe("owner expense entry", () => {
  it("throws while the flag is off and does not touch the database", async () => {
    let reads = 0;
    let writes = 0;
    await expect(runCreateOwnerExpense({
      enabled: false,
      userId: OWNER,
      roles: ["admin"],
      draft: draft(),
      vehicleExists: async () => { reads += 1; return true; },
      insert: async () => { writes += 1; return { id: "x" }; },
    })).rejects.toThrow("Owner expense entry is off");
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    expect(OWNER_EXPENSE_ENTRY_ENABLED).toBe(false);
  });

  it("refuses a manager before looking up the vehicle", async () => {
    let reads = 0;
    let writes = 0;
    await expect(runCreateOwnerExpense({
      enabled: true,
      userId: OWNER,
      roles: ["team"],
      draft: draft(),
      vehicleExists: async () => { reads += 1; return true; },
      insert: async () => { writes += 1; return { id: "x" }; },
    })).rejects.toThrow("Forbidden");
    expect(reads).toBe(0);
    expect(writes).toBe(0);
  });

  it("refuses amounts that are not positive dollars and cents", async () => {
    for (const amount of [0, -1, "0", "0.00", "-5", "1.005", "10.555", "", "abc", Number.NaN]) {
      let reads = 0;
      await expect(runCreateOwnerExpense({
        enabled: true,
        userId: OWNER,
        roles: ["admin"],
        draft: draft(amount),
        vehicleExists: async () => { reads += 1; return true; },
        insert: async () => { throw new Error("inserted"); },
      })).rejects.toThrow(/amount/i);
      expect(reads).toBe(0);
    }
  });

  it("inserts one row with the expense columns and no receipt when none was attached", async () => {
    let inserted: unknown = null;
    const result = await runCreateOwnerExpense({
      enabled: true,
      userId: OWNER,
      roles: ["admin"],
      draft: { ...draft(), vendorId: VENDOR, receiptPath: null, receiptName: null, receiptMime: null },
      vehicleExists: async () => true,
      vendorExists: async () => true,
      insert: async (row) => { inserted = row; return { id: "exp-1" }; },
    });
    expect(result).toEqual({ id: "exp-1" });
    expect(inserted).toEqual({
      vehicle_id: VEHICLE,
      incurred_on: "2026-10-21",
      amount: 25.5,
      category: "repair",
      vendor_id: VENDOR,
      description: "Brake pads",
      notes: "Front axle",
      created_by: OWNER,
      receipt_path: null,
      receipt_name: null,
      receipt_mime: null,
    });
    expect(ownerExpenseInsert(draft("10.50"), OWNER).amount).toBe(10.5);
  });

  it("does not insert when the vehicle is missing", async () => {
    let writes = 0;
    await expect(runCreateOwnerExpense({
      enabled: true,
      userId: OWNER,
      roles: ["admin"],
      draft: draft(),
      vehicleExists: async () => false,
      insert: async () => { writes += 1; return { id: "x" }; },
    })).rejects.toThrow("Vehicle was not found");
    expect(writes).toBe(0);
  });

  it("keeps the tab, the button, and the database behind the constant", () => {
    expect(visibleTabs("owner").some((tab) => tab.id === "expense_entry")).toBe(false);
    expect(railEntries("owner").some((tab) => tab.id === "expense_entry")).toBe(false);
    const handler = readFileSync(new URL("../src/lib/owner-expense-entry.functions.ts", import.meta.url), "utf8");
    const flagAt = handler.indexOf('throw new Error("Owner expense entry is off")');
    const roleAt = handler.indexOf('from("user_roles")');
    const writeAt = handler.indexOf('from("vehicle_expenses")');
    expect(flagAt).toBeGreaterThan(-1);
    expect(roleAt).toBeGreaterThan(flagAt);
    expect(writeAt).toBeGreaterThan(roleAt);
    expect(handler).not.toContain("supabaseAdmin");
    expect(handler).not.toContain("audit_log");
    expect(handler).not.toContain(".update(");
    expect(handler).not.toContain(".delete(");
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    expect(nav).toContain('if (!OWNER_EXPENSE_ENTRY_ENABLED || !tierAllows(tier, "owner")) return tabs');
    const tabsBlock = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    expect(tabsBlock).not.toContain("expense_entry");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).toContain('if (urlTab === "expense_entry")');
    expect(admin).toContain("OWNER_EXPENSE_ENTRY_ENABLED && tab === \"expense_entry\"");
    const panel = readFileSync(new URL("../src/components/admin/OwnerExpenseEntryPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("FileUploader");
    expect(panel).not.toContain('type="file"');
    expect(panel).toContain('from("receipts")');
  });
});
