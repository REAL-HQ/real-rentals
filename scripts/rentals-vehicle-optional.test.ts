import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bookingVehicleName, UNKNOWN_VEHICLE_LABEL, PAST_STATUS_VALUES } from "../src/lib/bookings-list";

const MIGRATION = resolve(import.meta.dirname, "../supabase/migrations/20261110020000_rentals_vehicle_optional_past.sql");

describe("optional vehicle on past rentals", () => {
  it("shows Unknown when unit and label are missing, and the recorded name otherwise", () => {
    expect(UNKNOWN_VEHICLE_LABEL).toBe("Unknown");
    expect(bookingVehicleName({ unitNumber: null, vehicleLabel: null })).toBe("Unknown");
    expect(bookingVehicleName({ unitNumber: "RR-001", vehicleLabel: null })).toBe("RR-001");
    expect(bookingVehicleName({ unitNumber: null, vehicleLabel: "2013 Ford Fusion" })).toBe("2013 Ford Fusion");
    expect(bookingVehicleName({ unitNumber: "RR-001", vehicleLabel: "2013 Ford Fusion" })).toBe("RR-001 · 2013 Ford Fusion");
  });

  it("is an additive migration that drops NOT NULL, keeps the FK, and allows null only for ended statuses", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/ALTER COLUMN vehicle_id DROP NOT NULL/);
    expect(sql).toMatch(/ADD CONSTRAINT rentals_vehicle_required_unless_ended/);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT rentals_vehicle_id_fkey/);
    expect(sql).not.toMatch(/ALTER TABLE public\.rentals DROP COLUMN/i);
    for (const status of PAST_STATUS_VALUES) {
      expect(sql).toContain(`'${status}'`);
    }
    // Active and reserved must still require a car.
    expect(sql).not.toMatch(/'active'/);
    expect(sql).not.toMatch(/'reserved'/);
  });
});
