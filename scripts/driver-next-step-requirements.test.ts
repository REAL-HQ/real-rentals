import { describe, expect, it } from "vitest";
import { activationRequirements, driverRequirementBlockers, type DriverReadinessFacts } from "../src/lib/activation-readiness";
import { driverNextStepRequirements } from "../src/lib/driver-next-step-requirements";
import { checklistAction } from "../src/components/admin/checklist-actions";

const facts: DriverReadinessFacts = {
  status: "approved", agreements: [], documents: [], interviewCompletedAt: null,
  hasPassedInspection: false,
  insurance: { status: "missing", exceptionAllowed: false, settingPresent: true, settingReadable: true },
};

describe("Next Step reservation payment facts", () => {
  it("marks Reservation Paid complete only for a saved paid reservation", () => {
    const requirements = activationRequirements(facts);
    expect(driverNextStepRequirements(requirements, "paid").find((item) => item.key === "reservation_paid")?.met).toBe(true);
    for (const status of ["pending", "not_required", "waived", "refunded", "unknown", null, undefined]) {
      expect(driverNextStepRequirements(requirements, status).find((item) => item.key === "reservation_paid")?.met).not.toBe(true);
    }
  });

  it("does not confuse reservation payment with approval, pickup or activation", () => {
    const requirements = activationRequirements(facts);
    const before = structuredClone(requirements);
    const blockers = driverRequirementBlockers(facts);
    const projected = driverNextStepRequirements(requirements, "paid");
    for (const requirement of requirements) {
      const displayed = projected.find((item) => item.key === requirement.key);
      if (displayed) expect({ met: displayed.met, enforcement: displayed.enforcement }).toEqual({ met: requirement.met, enforcement: requirement.enforcement });
    }
    expect(requirements).toEqual(before);
    expect(driverRequirementBlockers(facts)).toEqual(blockers);
    expect(projected.find((item) => item.key === "rental_active")?.met).toBe(false);
  });

  it("offers Release while the fee is unpaid, and View once it is paid", () => {
    const payment = driverNextStepRequirements([], "pending").find((item) => item.key === "reservation_paid");
    if (!payment) throw new Error("Missing reservation payment requirement");
    expect(checklistAction(payment)).toEqual({ label: "Release", target: { kind: "release_reservation_fee" } });
    expect(payment.enforcement).toBe("advisory");
    const paid = driverNextStepRequirements([], "paid").find((item) => item.key === "reservation_paid");
    expect(checklistAction(paid!)?.target).toEqual({ kind: "section", tab: "payments", anchor: "" });
  });

  it("shows a paid fee that did not hold a car, and a released fee", () => {
    const noCar = driverNextStepRequirements([], "paid_no_hold").find((item) => item.key === "reservation_paid");
    expect(noCar?.met).toBe(true);
    expect(noCar?.detail).toBe("Paid · No Car Held");
    const released = driverNextStepRequirements([], "expired").find((item) => item.key === "reservation_paid");
    expect(released?.met).toBeNull();
    expect(released?.detail).toBe("Released");
    expect(checklistAction(released!)?.label).toBe("View");
  });

  it("shows unpaid amount and due date from the reservation fee row", () => {
    const payment = driverNextStepRequirements([], "pending", null, { amount: 50, dueDate: "2026-11-24" }).find((item) => item.key === "reservation_paid");
    expect(payment?.met).toBe(false);
    expect(payment?.detail).toBe("Unpaid · $50 · Due Nov 24, 2026");
  });

  it("keeps Not Recorded when no reservation fee row exists", () => {
    const payment = driverNextStepRequirements([], null, null, { amount: 50, dueDate: "2026-11-24" }).find((item) => item.key === "reservation_paid");
    expect(payment?.met).toBeNull();
    expect(payment?.detail).toBe("Not Recorded");
  });

  it("shows Refunded - reason when the reservation fee was refunded", () => {
    const payment = driverNextStepRequirements([], "refunded:insurance_declined").find((item) => item.key === "reservation_paid");
    expect(payment?.met).not.toBe(true);
    expect(payment?.detail).toBe("Refunded - Insurance Declined");
  });
});