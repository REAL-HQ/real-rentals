import { describe, expect, test } from "bun:test";
import { defaultRentalEndIso, rentalEndBeforeMinimum } from "../src/lib/agreement-dates";
import { fillBlankAgreementDetails, type AgreementDetails } from "../src/lib/agreement-prep";

const base: AgreementDetails = {
  driverName: "Damon T Sykes",
  driverEmail: "driver@example.com",
  driverPhone: "8135550100",
  address: "",
  city: "",
  state: "",
  zip: "",
  dob: "",
  licenseNumber: "S123-456-78-901-0",
  licenseState: "FL",
  licenseExpiration: "2030-01-01",
  vehicleDescription: "2014 Ford Fusion",
  vehicleColor: "Silver",
  vehicleVin: "1FA6P0H70E5100000",
  licensePlate: "CZO6DA",
  startDate: "2026-11-09",
  endDate: "2026-12-07",
  weeklyRate: "350",
  cardOnFile: "Card ending 1234",
  insuranceCarrier: "",
  insurancePolicy: "",
};

describe("agreement rental presets", () => {
  test("the default end date is exactly four weeks after the start date", () => {
    expect(defaultRentalEndIso("2026-11-09")).toBe("2026-12-07");
  });

  test("an end date before four weeks is refused, while exactly four weeks is allowed", () => {
    expect(rentalEndBeforeMinimum("2026-11-09", "2026-12-06")).toBe(true);
    expect(rentalEndBeforeMinimum("2026-11-09", "2026-12-07")).toBe(false);
    expect(rentalEndBeforeMinimum("2026-11-09", "2026-12-14")).toBe(false);
  });
});

describe("license autofill", () => {
  test("fills blank address and DOB fields without replacing staff-entered identity details", () => {
    const result = fillBlankAgreementDetails(base, {
      driverName: "Different Name",
      licenseNumber: "DIFFERENT",
      address: "123 Main St",
      city: "Tampa",
      state: "FL",
      zip: "33601",
      dob: "1990-05-12",
    });
    expect(result.driverName).toBe("Damon T Sykes");
    expect(result.licenseNumber).toBe("S123-456-78-901-0");
    expect(result.address).toBe("123 Main St");
    expect(result.city).toBe("Tampa");
    expect(result.dob).toBe("1990-05-12");
  });
});
