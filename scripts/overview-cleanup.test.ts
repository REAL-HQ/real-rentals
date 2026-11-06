// Overview cleanup: consolidated leads, fleet occupancy, billed vs collected.
// Run: bun test scripts/overview-cleanup.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  activeRentalVehicleIds,
  summarizeFleet,
  summarizeFleetOccupancy,
} from "../src/lib/fleet-summary";
import {
  buildWeeklyBilledCollected,
  isOverviewRevenueType,
} from "../src/lib/overview-weekly-revenue";
import {
  LEAD_ALL_PAGE_ORDER,
  LEAD_FILTER_LABELS,
  leadBucketSort,
  leadFilterBuckets,
} from "../src/lib/lead-priorities";

describe("fleet occupancy from active rentals", () => {
  it("counts distinct active rental vehicles as rented and flags status mismatches", () => {
    const vehicles = [
      { id: "v1", status: "available" },
      { id: "v2", status: "rented" },
      { id: "v3", status: "rented" },
      { id: "v4", status: "maintenance" },
      { id: "v5", status: "available", archived_at: "2026-01-01" },
    ];
    const active = activeRentalVehicleIds([
      { vehicle_id: "v1" },
      { vehicle_id: "v1" }, // same vehicle, two rows — still one
      { vehicle_id: "v2" },
      { vehicle_id: null },
      { vehicle_id: "" },
    ]);
    expect([...active].sort()).toEqual(["v1", "v2"]);

    const occupancy = summarizeFleetOccupancy(vehicles, active);
    expect(occupancy.rented).toBe(2); // v1 + v2
    expect(occupancy.available).toBe(1); // v3 was status-rented with no active rental
    expect(occupancy.maintenance).toBe(1);
    expect(occupancy.total).toBe(4); // archived excluded
    expect(occupancy.mismatches).toEqual([
      { vehicleId: "v1", status: "available", kind: "active_without_rented_status" },
      { vehicleId: "v3", status: "rented", kind: "status_rented_without_active" },
    ]);
    expect(occupancy.utilizationPct).toBe(Math.round((2 / (1 + 0 + 2)) * 100));
  });

  it("status-only summarizeFleet remains unchanged for waitlist callers", () => {
    expect(summarizeFleet([{ status: "rented" }, { status: "available" }]).rented).toBe(1);
  });
});

describe("billed vs collected series", () => {
  it("excludes deposits and aligns collected with multi-method revenue types", () => {
    expect(isOverviewRevenueType("deposit")).toBe(false);
    expect(isOverviewRevenueType("rent")).toBe(true);
    const now = new Date("2026-11-05T15:00:00Z");
    const series = buildWeeklyBilledCollected({
      now,
      weeks: 2,
      label: (d) => d.toISOString().slice(0, 10),
      collected: [
        { paid_date: "2026-11-05", net_collected: 300, type: "rent" },
        { paid_date: "2026-11-05", net_collected: 500, type: "deposit" },
        { paid_date: "2026-11-04", net_collected: 40, type: "late_fee" },
        { paid_date: "2026-10-28", net_collected: 200, type: "rent" }, // prior Sun–Sat week
      ],
      billed: [
        { due_date: "2026-11-05", amount: 300, type: "rent" },
        { due_date: "2026-11-05", amount: 500, type: "deposit" },
        { due_date: "2026-10-28", amount: 200, type: "rent" },
      ],
    });
    expect(series).toHaveLength(2);
    const thisWeek = series[1];
    expect(thisWeek.collected).toBe(340);
    expect(thisWeek.billed).toBe(300);
    expect(series[0].collected).toBe(200);
    expect(series[0].billed).toBe(200);
  });
});

describe("lead priority filters and sort", () => {
  it("surfaces new/interested before overdue in All page order", () => {
    expect(LEAD_ALL_PAGE_ORDER.slice(0, 3)).toEqual(["new", "interested", "overdue"]);
    expect(leadFilterBuckets("follow_up_due")).toEqual(["overdue", "today"]);
    expect(leadFilterBuckets("interested")).toEqual(["interested"]);
    expect(LEAD_FILTER_LABELS.all).toBe("All");
    expect(leadBucketSort("new")).toEqual({ primary: "created_at", ascending: false });
    expect(leadBucketSort("overdue").ascending).toBe(true);
  });
});

describe("Overview wiring", () => {
  it("drops Hot Prospects and StripeCollections; mounts Stripe under Payments", () => {
    const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
    const payments = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
    const leads = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
    expect(overview).not.toContain("Hot Prospects");
    expect(overview).not.toContain("isHotProspect");
    expect(overview).not.toContain("<StripeCollections");
    expect(overview).toContain("summarizeFleetOccupancy");
    expect(overview).toContain("buildWeeklyBilledCollected");
    expect(overview).toMatch(/refreshKey=\{opsRefreshKey\}/);
    expect(payments).toContain("<StripeCollections");
    expect(payments).toContain("Stripe Collections");
    expect(leads).toContain("Follow-Up Due");
    expect(leads).toContain("ReadinessStatePill");
    expect(leads).toContain("Applied");
    expect(leads).toContain("Last contact");
  });
});

describe("Overview KPI tile refresh and Revenue density", () => {
  it("refreshes Service and Stripe collections with opsRefreshKey; denser Revenue row", () => {
    const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
    // Service counts used to load once ([]); they must follow the shared refresh key.
    expect(overview).toMatch(/fleetMaint\(\)[\s\S]*?\}, \[opsRefreshKey\]\);/);
    expect(overview).toContain('invalidateQueries({ queryKey: ["stripe-collections"] })');
    expect(overview).toContain("items-start");
    expect(overview).toContain("grid grid-cols-2 gap-x-3");
    expect(overview).toContain("Projected / Collected");
    expect(overview).toContain('? "Loading"');
    expect(overview).toContain("${vehiclesTotal} In Fleet · ${activeRentalCount} Active");
  });
});
