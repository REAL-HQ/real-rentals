import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { vehicleCellParts } from "../src/lib/vehicle-cell";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("vehicleCellParts", () => {
  test("full record", () => {
    const p = vehicleCellParts({ year: 2013, make: "Ford", model: "Fusion", plate: "xlk331", vin: "1FADP3F2XDL123456", unitNumber: "RR-004" });
    expect(p.title).toBe("2013 Ford Fusion");
    expect(p.detailLine).toBe("XLK331 · VIN …123456");
  });
  test("pre-joined label drops unit and plate from the title", () => {
    const p = vehicleCellParts({ label: "Unit RR-004 · 2013 Ford Fusion · XLK331", unitNumber: "RR-004", plate: "XLK331", vinLast6: "123456" });
    expect(p.title).toBe("2013 Ford Fusion");
    expect(p.detailLine).toBe("XLK331 · VIN …123456");
  });
  test("missing plate, VIN and photo never show undefined or stray separators", () => {
    const p = vehicleCellParts({ year: 2020, make: "Kia", model: "Soul" });
    expect(p.detailLine).toBe("—");
    expect(p.plate).toBeNull();
    expect(p.vinLast6).toBeNull();
    expect(vehicleCellParts(null).title).toBe("Vehicle Not Listed");
    expect(vehicleCellParts({ unitNumber: "RR-9" }).title).toBe("Unit RR-9");
    expect(vehicleCellParts({ unitNumber: "RR-9" }).detailLine).toBe("—");
  });
  test("short VIN is kept whole, full VIN never leaves", () => {
    expect(vehicleCellParts({ vin: "ABC" }).vinLast6).toBe("ABC");
    expect(vehicleCellParts({ vin: "1FADP3F2XDL123456" }).detailLine).not.toContain("1FADP3");
  });
});

describe("shared cell is used in every list", () => {
  const users: Array<[string, string]> = [
    ["BookingsPanel (Past/All)", "components/admin/BookingsPanel.tsx"],
    ["ReservationsPanel (Reserved)", "components/admin/ReservationsPanel.tsx"],
    ["ActiveRentalsPanel", "components/admin/ActiveRentalsPanel.tsx"],
    ["DriversPanel profile card", "components/admin/DriversPanel.tsx"],
    ["PaymentsPanel", "components/admin/PaymentsPanel.tsx"],
    ["ExpensesPanel", "components/admin/ExpensesPanel.tsx"],
    ["DriverIssuesPanel", "components/admin/DriverIssuesPanel.tsx"],
    ["FleetServiceCenter", "components/admin/FleetServiceCenter.tsx"],
    ["FleetInboxPanel", "components/admin/FleetInboxPanel.tsx"],
    ["OverviewPanel", "components/admin/OverviewPanel.tsx"],
    ["ChargesPanel", "components/admin/ChargesPanel.tsx"],
    ["IncidentsPanel", "components/admin/IncidentsPanel.tsx"],
    ["PartnerStatementPanel", "components/admin/PartnerStatementPanel.tsx"],
    ["RevenueForecastPanel", "components/admin/RevenueForecastPanel.tsx"],
    ["FleetAvailability", "components/admin/FleetAvailability.tsx"],
    ["StripeMatchPanel", "components/admin/StripeMatchPanel.tsx"],
    ["RenterReimbursements", "components/admin/RenterReimbursements.tsx"],
    ["RenewalsDue", "components/admin/RenewalsDue.tsx"],
    ["BillingHealthPanel", "components/admin/BillingHealthPanel.tsx"],
    ["MaintenanceDue", "components/admin/MaintenanceDue.tsx"],
    ["MaintenanceSchedules", "components/admin/MaintenanceSchedules.tsx"],
  ];
  for (const [name, file] of users) test(name, () => expect(src(file)).toMatch(/(Linked)?VehicleCell/));

  test("bookings list query carries VIN and photo", () => {
    const f = src("lib/bookings.functions.ts");
    expect(f).toContain('"id,unit_number,year,make,model,license_plate,vin"');
    expect(f).toContain("loadVehicleThumbnailPaths");
  });
  test("active rentals query carries VIN", () => {
    expect(src("lib/active-rentals.functions.ts")).toContain("license_plate,vin,plate_expires_on");
  });
  test("thumbnail click does not open the row", () => {
    expect(src("components/admin/VehicleCell.tsx")).toContain("e.stopPropagation()");
  });
  test("the enlarged photo title and plate open the vehicle and close the popup", () => {
    const cell = src("components/admin/VehicleCell.tsx");
    expect(cell).toContain('data-testid="vehicle-photo-title"');
    expect(cell).toContain('data-testid="vehicle-photo-plate"');
    expect(cell).toContain('tab: "vehicles"');
    expect(cell).toContain("setOpen(false)");
    expect(src("components/admin/ReservationsPanel.tsx")).toContain("vehicleId={row.vehicleId}");
  });
  test("card endpoint is staff only and returns no full VIN", () => {
    const f = src("lib/vehicle-cards.functions.ts");
    expect(f).toContain("requireStaff");
    expect(f).not.toMatch(/vin:\s/);
  });
});
