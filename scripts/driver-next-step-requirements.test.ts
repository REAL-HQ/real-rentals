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

  it("opens the existing payments section instead of offering a manual payment check-off", () => {
    const payment = driverNextStepRequirements([], "pending").find((item) => item.key === "reservation_paid");
    if (!payment) throw new Error("Missing reservation payment requirement");
    expect(checklistAction(payment)?.target).toEqual({ kind: "section", tab: "payments", anchor: "" });
    expect(payment.enforcement).toBe("advisory");
  });
});