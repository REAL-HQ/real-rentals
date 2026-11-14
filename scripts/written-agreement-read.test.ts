import { describe, expect, test } from "bun:test";
import { parseWrittenAgreementDetails } from "../src/lib/agreement-document-read";
import { fillBlankAgreementDetails, type AgreementDetails } from "../src/lib/agreement-prep";

const current: AgreementDetails = {
  driverName: "Damon T Sykes", driverEmail: "driver@example.com", driverPhone: "",
  address: "", city: "", state: "", zip: "", dob: "", licenseNumber: "S123", licenseState: "FL", licenseExpiration: "",
  vehicleDescription: "2014 Ford Fusion", vehicleColor: "", vehicleVin: "1FA6P0H70E5100000", licensePlate: "",
  startDate: "", endDate: "", weeklyRate: "350", cardOnFile: "", insuranceCarrier: "", insurancePolicy: "",
};

describe("written agreement reading", () => {
  test("keeps explicit rental dates, vehicle and rate fields and ignores unknown output", () => {
    const details = parseWrittenAgreementDetails({
      startDate: "2026-10-06", endDate: "2026-11-03", weeklyRate: "375",
      vehicleColor: "Silver", licensePlate: "ABC123", invented: "ignored",
    });
    expect(details).toMatchObject({ startDate: "2026-10-06", endDate: "2026-11-03", weeklyRate: "375", vehicleColor: "Silver", licensePlate: "ABC123" });
    expect(details).not.toHaveProperty("invented");
  });

  test("does not turn non-string or uncertain output into contract facts", () => {
    const details = parseWrittenAgreementDetails({ weeklyRate: 350, vehicleVin: null, startDate: " 2026-10-06 " });
    expect(details.weeklyRate).toBe("");
    expect(details.vehicleVin).toBe("");
    expect(details.startDate).toBe("2026-10-06");
  });

  test("extracted details fill blanks only and never overwrite reviewed rental values", () => {
    const next = fillBlankAgreementDetails(current, { driverName: "Different", weeklyRate: "999", startDate: "2026-10-06", endDate: "2026-11-03", vehicleColor: "Silver" });
    expect(next.driverName).toBe("Damon T Sykes");
    expect(next.weeklyRate).toBe("350");
    expect(next.startDate).toBe("2026-10-06");
    expect(next.endDate).toBe("2026-11-03");
    expect(next.vehicleColor).toBe("Silver");
  });

  test("an unreadable reader response is refused", () => {
    expect(() => parseWrittenAgreementDetails(null)).toThrow("unreadable result");
  });
});
