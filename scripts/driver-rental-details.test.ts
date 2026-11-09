import { describe, it, expect } from "vitest";
import { driverRentalFacts } from "../src/components/admin/driver-rental-details";
import type { BookingDetail } from "../src/lib/bookings.functions";

const saved = {
  booking: { applicationId: "damon", status: "active", phase: "active", startDate: "2026-11-09", endDate: null, openEnded: true, weeklyRate: 350 },
  mileage: { pickup: 158964, return: null },
  money: { deposit: { amount: 0 } }, canSeeMoney: true,
} as BookingDetail;

describe("saved driver rental details", () => {
  it("shows the rental start, weekly rate, zero deposit and linked pickup reading without substituting application drafts", () => {
    expect(driverRentalFacts(saved, "damon")).toEqual({ status: "active", startDate: "2026-11-09", endDate: null, active: true, openEnded: true, mileageOut: 158964, mileageIn: null, money: { weeklyRate: 350, deposit: 0 } });
  });
  it("refuses another applicant's rental", () => {
    expect(driverRentalFacts(saved, "other-applicant")).toBeNull();
  });
  it("keeps money absent from an operational-only response", () => {
    expect(driverRentalFacts({ ...saved, canSeeMoney: false }, "damon")).not.toHaveProperty("money");
  });
  it("preserves missing values rather than inventing rates, deposits or mileage", () => {
    const facts = driverRentalFacts({ ...saved, booking: { ...saved.booking, weeklyRate: null }, mileage: { pickup: null, return: null }, money: undefined }, "damon");
    expect(facts?.mileageOut).toBeNull();
    expect(facts?.money).toEqual({ weeklyRate: null, deposit: null });
  });
});