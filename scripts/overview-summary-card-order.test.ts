// Overview summary cards sit above Lead Priorities, in health-check order.
// Run: bun test scripts/overview-summary-card-order.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const GRID = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4';

function mustIndex(source: string, marker: string, label = marker) {
  const index = source.indexOf(marker);
  expect(index, `missing ${label}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("Overview summary card placement", () => {
  const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");

  it("places the four-card row after Overview Today and above Lead Priorities", () => {
    const today = mustIndex(overview, "<OverviewToday");
    const grid = mustIndex(overview, GRID, "summary card grid");
    const leads = mustIndex(overview, "<LeadPriorities");
    const followup = mustIndex(overview, "<BookingFollowupSlot");
    const conversion = mustIndex(overview, "<BookingConversion");
    const chip = mustIndex(overview, "<DocumentsExpiringChip");
    const snapshot = mustIndex(overview, 'title="Fleet Snapshot"');

    expect(today).toBeLessThan(grid);
    expect(grid).toBeLessThan(leads);
    expect(leads).toBeLessThan(followup);
    expect(followup).toBeLessThan(conversion);
    expect(conversion).toBeLessThan(chip);
    expect(chip).toBeLessThan(snapshot);
    expect(overview.split(GRID)).toHaveLength(2);
  });

  it("orders the row Revenue, Collections, Service, then Active Renters", () => {
    const grid = mustIndex(overview, GRID);
    const leads = mustIndex(overview, "<LeadPriorities");
    const block = overview.slice(grid, leads);

    const revenue = mustIndex(block, "<RevenueCard");
    const collections = mustIndex(block, 'eyebrow="Collections"');
    const service = mustIndex(block, 'eyebrow="Service"');
    const renters = mustIndex(block, 'eyebrow="Active Renters"');
    expect(revenue).toBeLessThan(collections);
    expect(collections).toBeLessThan(service);
    expect(service).toBeLessThan(renters);
    expect(block).not.toContain('title="Add Vehicle"');
    expect(block).not.toContain('eyebrow="Fleet"');
    expect(block).toContain("{MAINTENANCE_LOG_ENABLED ? <MaintenanceDueTile /> : null}");
    expect(block.indexOf("<MaintenanceDueTile")).toBeGreaterThan(renters);
  });

  it("keeps each card's links, controls, and expand wiring", () => {
    const grid = mustIndex(overview, GRID);
    const leads = mustIndex(overview, "<LeadPriorities");
    const block = overview.slice(grid, leads);
    const revenue = block.slice(block.indexOf("<RevenueCard"), block.indexOf('eyebrow="Collections"'));
    const collections = block.slice(block.indexOf('eyebrow="Collections"'), block.indexOf('eyebrow="Service"'));
    const service = block.slice(block.indexOf('eyebrow="Service"'), block.indexOf('eyebrow="Active Renters"'));
    const renters = block.slice(block.indexOf('eyebrow="Active Renters"'), block.indexOf("<MaintenanceDueTile"));

    expect(revenue).toContain("onRangeKey={setRangeKey}");
    expect(revenue).toContain("projected={projected}");
    expect(revenue).toContain("expanded={summaryExpanded}");

    expect(collections).toContain('search={{ tab: "payments", filter: "overdue" }}');
    expect(collections).toContain('control="view"');
    expect(collections).toContain('surface="yellow"');

    expect(service).toContain('search={{ tab: "maintenance" }}');
    expect(service).toContain('control="view"');
    expect(service).toContain('surface="red"');
    expect(service).toContain('search={{ tab: "vehicles", id: row.vehicle.id }}');

    expect(renters).toContain('search={{ tab: "drivers", filter: "active" }}');
    expect(renters).toContain('control="view"');
    expect(renters).toContain("activeRentalCount");
  });
});
