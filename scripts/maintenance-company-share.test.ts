import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAINTENANCE_COMPANY_SHARE_ENABLED } from "../src/lib/maintenance-company-share-flag";
import { companyShareInsert, proposedCompanyMaintenanceDollars } from "../src/lib/maintenance-company-share";

describe("company share stays at the database default while the flag is false", () => {
  it("is a hard false constant", () => {
    expect(MAINTENANCE_COMPANY_SHARE_ENABLED).toBe(false);
  });

  it("omits company_share for an unlinked cost, a linked cost, a blank total, and a zero net", () => {
    expect(companyShareInsert({ linkedExpense: false, totalCost: 80 })).toEqual({});
    expect(companyShareInsert({ linkedExpense: true, totalCost: 80, warrantyCovered: 0 })).toEqual({});
    expect(companyShareInsert({ linkedExpense: false, totalCost: null })).toEqual({});
    expect(companyShareInsert({ linkedExpense: false, totalCost: 40, warrantyCovered: 40 })).toEqual({});
  });
});

describe("proposed company amount, not used by the live report", () => {
  it("counts an unlinked zero share as the net company cost", () => {
    expect(proposedCompanyMaintenanceDollars({
      companyShare: 0, partnerShare: 0, totalCost: 80, linkedExpense: false,
    })).toBe(80);
    expect(proposedCompanyMaintenanceDollars({
      companyShare: 0, partnerShare: 0, totalCost: 100, warrantyCovered: 15, vendorCredit: 10, linkedExpense: false,
    })).toBe(75);
  });

  it("keeps a positive company share and does not fall through from a zero share when the partner share is set", () => {
    expect(proposedCompanyMaintenanceDollars({
      companyShare: 40, partnerShare: 60, totalCost: 100, linkedExpense: false,
    })).toBe(40);
    expect(proposedCompanyMaintenanceDollars({
      companyShare: 0, partnerShare: 50, totalCost: 100, linkedExpense: false,
    })).toBe(0);
  });

  it("does not add total cost again when a linked expense exists", () => {
    expect(proposedCompanyMaintenanceDollars({
      companyShare: 0, partnerShare: 0, totalCost: 80, linkedExpense: true,
    })).toBe(0);
    expect(proposedCompanyMaintenanceDollars({
      companyShare: 80, partnerShare: 0, totalCost: 80, linkedExpense: true,
    })).toBe(0);
  });

  it("would write the net share only when the flag is passed true and no expense is linked", () => {
    expect(companyShareInsert({ linkedExpense: false, totalCost: 80 }, true)).toEqual({ company_share: 80 });
    expect(companyShareInsert({ linkedExpense: false, totalCost: 100, warrantyCovered: 20, vendorCredit: 5 }, true)).toEqual({ company_share: 75 });
    expect(companyShareInsert({ linkedExpense: true, totalCost: 80 }, true)).toEqual({});
    expect(companyShareInsert({ linkedExpense: false, totalCost: 0 }, true)).toEqual({});
    expect(companyShareInsert({ linkedExpense: false, totalCost: null }, true)).toEqual({});
  });
});

describe("the live inserts and the live report do not change while the flag is false", () => {
  it("spreads the helper into the three saves and leaves the profitability calculator alone", () => {
    const panel = readFileSync("src/components/admin/MaintenancePanel.tsx", "utf8");
    const schedules = readFileSync("src/components/admin/MaintenanceSchedules.tsx", "utf8");
    const server = readFileSync("src/lib/maintenance.server.ts", "utf8");
    const vehicles = readFileSync("src/lib/unified-finance-vehicles.ts", "utf8");
    const live = readFileSync("src/lib/unified-finance-live.server.ts", "utf8");
    for (const source of [panel, schedules, server]) {
      expect(source.match(/companyShareInsert\(/g)).toHaveLength(1);
      expect(source).toMatch(/companyShareInsert\(\{[^}]*\}\)/);
      expect(source).not.toMatch(/companyShareInsert\(\{[^}]*\},\s*true\)/);
      expect(source).not.toMatch(/company_share\s*:/);
    }
    expect(panel).toContain('placeholder="Cost ($)"');
    expect(schedules).toContain(">Cost $<");
    expect(vehicles).not.toContain("MAINTENANCE_COMPANY_SHARE");
    expect(vehicles).not.toContain("proposedCompanyMaintenanceDollars");
    expect(live).not.toContain("MAINTENANCE_COMPANY_SHARE");
    expect(readFileSync("src/lib/rentals.functions.ts", "utf8")).not.toContain("companyShareInsert");
    expect(readFileSync("src/lib/incidents.functions.ts", "utf8")).not.toContain("companyShareInsert");
  });

  it("keeps the reporting change in proposed SQL", () => {
    const sql = readFileSync("proposed/maintenance-company-share-v1.sql", "utf8");
    expect(sql.startsWith("-- LOCAL PROPOSAL ONLY. Not a migration. Do not apply.")).toBe(true);
    expect(sql).toContain("WHEN m.company_share = 0 AND m.partner_share = 0 AND m.total_cost > 0 THEN");
    expect(sql).toContain("e.maintenance_record_id = m.id");
    expect(sql).toContain("total_cost_omitted");
    expect(sql).not.toMatch(/^SELECT /m);
  });
});
