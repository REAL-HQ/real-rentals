import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OWNER_PNL_ENABLED } from "../src/lib/owner-pnl-flag";

describe("admin dashboard currency", () => {
  test("Owner P&L is enabled for live monthly figures", () => {
    expect(OWNER_PNL_ENABLED).toBe(true);
  });

  test("Overview counts live active rentals and refreshes on focus", () => {
    const src = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
    expect(src).toMatch(/\.eq\("status", "active"\)/);
    expect(src).toMatch(/setActiveRentalCount/);
    expect(src).toMatch(/opsRefreshKey/);
    expect(src).toMatch(/Open Active/);
    expect(src).toMatch(/window\.addEventListener\("focus"/);
    expect(src).toMatch(/summarizeFleetOccupancy/);
    expect(src).not.toMatch(/Hot Prospects/);
    expect(src).not.toMatch(/<StripeCollections/);
  });
});
