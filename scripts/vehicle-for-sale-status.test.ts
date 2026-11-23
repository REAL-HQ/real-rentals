// For Sale is a settable vehicle status with a blue badge. It stays on the
// admin list and in the fleet snapshot, and it is excluded from every
// available listing, picker, count, and GPS match.
// Run: bun test scripts/vehicle-for-sale-status.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { VEHICLE_STATUSES } from "../src/lib/vehicles.functions";
import { availabilityLabel, summarizeVehicleFleetStats } from "../src/lib/vehicles-list";
import { vehicleAvailability } from "../src/lib/vehicle-readiness";
import { formatStatusLabel } from "../src/lib/ui-display-labels";
import {
  FOR_SALE_VEHICLE_STATUS,
  fleetSnapshotSlices,
  isForSaleVehicleStatus,
  isPublicHiddenVehicleStatus,
  summarizeFleet,
  summarizeFleetOccupancy,
} from "../src/lib/fleet-summary";
import { buildFleetAvailability } from "../src/lib/fleet-availability";
import { buildRevenueForecast } from "../src/lib/revenue-forecast";
import { buildVehicleTurnaround } from "../src/lib/vehicle-turnaround";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("For Sale status", () => {
  test("is a Title Case choice in the edit dropdown, after Sold", () => {
    const sale = VEHICLE_STATUSES.find((status) => status.value === "for_sale");
    expect(sale).toEqual({ value: "for_sale", label: "For Sale" });
    const values = VEHICLE_STATUSES.map((status) => status.value);
    expect(values.indexOf("sold")).toBeLessThan(values.indexOf("for_sale"));
    expect(values.indexOf("for_sale")).toBeLessThan(values.indexOf("retired"));
    expect(values).toContain("available");
    expect(formatStatusLabel("for_sale")).toBe("For Sale");
    expect(formatStatusLabel("For Sale")).toBe("For Sale");
    expect(availabilityLabel({ on_rent: false, status: "for_sale" })).toBe("For Sale");
    expect(availabilityLabel({ on_rent: true, status: "for_sale" })).toBe("Rented");
    expect(vehicleAvailability("for_sale", false)).toBe("For Sale");
    expect(vehicleAvailability("For Sale", false)).toBe("For Sale");
    expect(vehicleAvailability("for_sale", true)).toBe("Rented");
  });

  test("uses a blue badge and a blue fleet-snapshot slice", () => {
    const badge = read("src/components/VehicleStatusBadge.tsx");
    const tones = read("src/components/ui/badge.tsx");
    expect(badge).toContain('key === "for_sale" ? "sale"');
    expect(badge).toContain('key === "for_sale" ? "For Sale"');
    expect(tones).toContain('sale: "border-[#007AFF]/30 bg-[#E8F3FF] text-[#007AFF]"');

    const snapshot = summarizeFleet([
      { status: "available" },
      { status: "for_sale" },
      { status: "For Sale" },
      { status: "sold" },
      { status: "retired" },
    ]);
    expect(snapshot.total).toBe(3);
    expect(snapshot.available).toBe(1);
    expect(snapshot.forSale).toBe(2);
    expect(snapshot.other).toBe(0);
    expect(snapshot.rentable).toBe(1);
    const slices = Object.fromEntries(fleetSnapshotSlices(snapshot).map((slice) => [slice.key, slice]));
    expect(slices.for_sale).toMatchObject({ label: "For Sale", value: 2, color: "#007AFF" });
    expect(slices.available).toMatchObject({ value: 1 });
  });

  test("an active rental still counts as rented, not as available or For Sale", () => {
    const snapshot = summarizeFleetOccupancy(
      [{ id: "sale", status: "for_sale" }, { id: "open", status: "available" }],
      ["sale"],
    );
    expect(snapshot.rented).toBe(1);
    expect(snapshot.forSale).toBe(0);
    expect(snapshot.available).toBe(1);
    expect(snapshot.rentable).toBe(2);

    const page = summarizeVehicleFleetStats(
      [
        { id: "sale", status: "for_sale" },
        { id: "open", status: "available" },
        { id: "gone", status: "sold" },
      ],
      new Set(),
    );
    expect(page.available).toBe(1);
    expect(page.other).toBe(2);
  });

  test("is not rentable, not idle capacity, and not in the turnaround queue", () => {
    expect(isForSaleVehicleStatus("for_sale")).toBe(true);
    expect(isForSaleVehicleStatus("For Sale")).toBe(true);
    expect(isPublicHiddenVehicleStatus(FOR_SALE_VEHICLE_STATUS)).toBe(true);
    expect(isPublicHiddenVehicleStatus("available")).toBe(false);

    const board = buildFleetAvailability({
      todayEt: "2026-11-23",
      vehicles: [{
        id: "sale",
        unitNumber: "RR-004",
        year: 2013,
        make: "Ford",
        model: "Fusion",
        plate: "XLK331",
        status: "for_sale",
        archivedAt: null,
        registrationExpiresOn: "2027-01-01",
        insuranceExpiresOn: "2027-01-01",
      }],
      rentals: [],
      incidents: [],
    });
    expect(board.counts.available_now).toBe(0);
    expect(board.counts.not_rentable).toBe(1);
    expect(board.groups.find((group) => group.id === "not_rentable")?.rows[0]?.statusLabel).toBe("For Sale");

    const forecast = buildRevenueForecast({
      today: "2026-11-23",
      rentals: [],
      vehicles: [
        { id: "sale", label: "RR-004", status: "for_sale", weeklyRate: 350, archived: false },
        { id: "open", label: "Open", status: "available", weeklyRate: 350, archived: false },
      ],
    });
    expect(forecast?.idleCount).toBe(1);

    const turnaround = buildVehicleTurnaround({
      today: "2026-11-23",
      vehicles: [{
        id: "sale",
        year: 2013,
        make: "Ford",
        model: "Fusion",
        license_plate: "XLK331",
        unit_number: "RR-004",
        status: "for_sale",
        archived_at: null,
        registration_expires_on: "2027-01-01",
        insurance_expires_on: "2027-01-01",
      }],
      rentals: [{ id: "ended", vehicle_id: "sale", status: "completed", end_date: "2026-11-01" }],
      pickups: [],
      services: [],
    });
    expect(turnaround.rows.map((row) => row.vehicleId)).not.toContain("sale");
  });

  test("public listings, pickers, counts, and GPS matching exclude it", () => {
    const fleet = read("src/routes/fleet.index.tsx");
    const detail = read("src/routes/fleet.$id.tsx");
    const home = read("src/routes/index.tsx");
    const sitemap = read("src/routes/sitemap[.]xml.ts");
    const gallery = read("src/routes/api/public/vehicle-gallery/$id.ts");
    const filters = read("src/lib/fleet-filters.ts");
    const reserve = read("src/lib/reservations.functions.ts");
    const swap = read("src/lib/vehicle-swap.server.ts");
    const assign = read("src/lib/fleet-assign.server.ts");
    const activate = read("src/components/admin/ActivateRentalDialog.tsx");
    const record = read("src/components/admin/RecordRentalDialog.tsx");
    const drivers = read("src/components/admin/DriversPanel.tsx");
    const list = read("src/lib/vehicles-list.functions.ts");
    const editor = read("src/components/admin/VehicleProfile.tsx");
    const drawer = read("src/components/admin/VehicleEditorDrawer.tsx");
    const gps = read("src/lib/gps-alerts.server.ts");
    const payment = read("src/lib/payment-received.server.ts");
    const terms = read("src/lib/staff-terms.server.ts");
    const rentals = read("src/lib/rentals.functions.ts");
    const migration = read("supabase/migrations/20261123210000_vehicles_public_hide_for_sale.sql");
    const add = read("src/components/admin/AddVehicleDialog.tsx");

    expect(fleet).toContain('.neq("status", "for_sale")');
    expect(fleet).toContain("isPublicHiddenVehicleStatus");
    expect(detail).toContain("isPublicHiddenVehicleStatus(data.status)");
    expect(home).toContain('.eq("status", "available")');
    expect(sitemap).toContain('.neq("status", "for_sale")');
    expect(gallery).toContain("isPublicHiddenVehicleStatus(listed.status)");
    expect(filters).toContain("isPublicHiddenVehicleStatus(row.status)");
    expect(reserve).toContain("isForSaleVehicleStatus(vStatus)");
    expect(reserve).toContain("!isForSaleVehicleStatus(v.status)");
    expect(reserve).toContain('.in("status", ["available", "ready", "onboarding"])');
    expect(swap).toContain('.eq("status", "available").is("archived_at", null)');
    expect(assign).toContain('.eq("status", "available").is("archived_at", null)');
    expect(activate).toContain("!isForSaleVehicleStatus(v.status)");
    expect(record).toContain("!isForSaleVehicleStatus(v.status)");
    expect(drivers).toContain("!isForSaleVehicleStatus(v.status)");
    expect(list).toContain('"for_sale"');
    expect(editor).toContain("VEHICLE_STATUSES.map");
    expect(drawer).toContain("VEHICLE_STATUSES.map");
    expect(gps).toContain("!isForSaleVehicleStatus(c.status)");
    expect(payment).toContain("isForSaleVehicleStatus(vs)");
    expect(terms).toContain("That Vehicle Is For Sale. Choose Another.");
    expect(rentals).toContain('code: "vehicle_for_sale"');
    expect(add).toContain('"for_sale"');
    expect(migration).toContain("AND v.status NOT IN ('retired', 'archived', 'sold', 'for_sale')");
    expect(migration).not.toMatch(/UPDATE\s+public\.vehicles/i);
  });
});
