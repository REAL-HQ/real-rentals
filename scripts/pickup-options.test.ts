import { describe, expect, it } from "vitest";
import { PICKUP_COORDINATION, PICKUP_PAYMENT_METHODS, pickupLocationSuggestion } from "../src/lib/pickup-options";
describe("Owner-confirmed pickup choices", () => {
  it("the team confirms the appointment", () => expect(PICKUP_COORDINATION.appointmentOwner).toBe("team"));
  it("login access comes first without waiting for a pickup packet", () => expect(PICKUP_COORDINATION.approvalEmail).toBe("login_first"));
  it("offers the specified Hillsborough address", () => expect(pickupLocationSuggestion("hillsborough")).toBe("3500 E. Hillsborough Ave., Tampa, FL 33610"));
  it("offers the specified County Line address", () => expect(pickupLocationSuggestion("county_line")).toBe("6411 E County Line Rd., Tampa, FL 33647"));
  it("permits another location and does not choose an address automatically", () => {
    expect(PICKUP_COORDINATION.customLocationAllowed).toBe(true);
    expect(PICKUP_COORDINATION.defaultLocation).toBeNull();
    expect(pickupLocationSuggestion("custom")).toBeNull();
  });
  it("includes every requested pickup payment method without verifying a payment", () => expect(PICKUP_PAYMENT_METHODS.map((method) => method.id)).toEqual(["stripe", "zelle_bank", "cash_app_venmo", "cash", "other"]));
});