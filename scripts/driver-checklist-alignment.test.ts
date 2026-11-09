import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activationRequirements, type DriverReadinessFacts } from "../src/lib/activation-readiness";
import { attestationInput, projectEvidence, requirementEvidence } from "../src/lib/checklist-evidence";
import { driverLifecycle } from "../src/lib/driver-lifecycle";

const facts: DriverReadinessFacts = {
  status: "approved",
  agreements: [],
  documents: [],
  interviewCompletedAt: null,
  hasPassedInspection: false,
  rentalActive: false,
  insurance: { status: "missing", exceptionAllowed: false, settingPresent: true, settingReadable: true },
};

describe("Driver checklist alignment", () => {
  it("uses Dolmar's nine Next Step labels and order", () => {
    const items = activationRequirements(facts).filter((item) => !["insurance_document", "gig_platform"].includes(item.key));
    expect(items.map((item) => item.label)).toEqual([
      "Interview Complete",
      "Driver's License Verified",
      "Gig Profile Verified",
      "Insurance Verified",
      "Application Approved",
      "Pre-Inspection Passed",
      "Rental Agreement Signed",
      "Pickup Complete",
      "Rental Active",
    ]);
  });

  it("adds Profile after License in the lifecycle", () => {
    const result = driverLifecycle({ contacted: true, screening: true, documents: false, profile: false, insuranceOnFile: false, approved: true, inspection: false, agreement: false, rentalActive: false });
    expect(result.stages.map((stage) => stage.label)).toEqual(["Applied", "Contacted", "Screening", "License", "Profile", "Insurance", "Approved", "Inspection", "Agreement", "Pickup", "Active"]);
  });

  it("saves a file-free inspection check-off as Yellow, never Passed", () => {
    const applicationId = "11111111-1111-4111-8111-111111111111";
    const input = { applicationId, field: "inspection", expectedRevision: 0, idempotencyKey: applicationId, state: "collected", source: "other", note: "" } as const;
    expect(attestationInput.parse(input).field).toBe("inspection");
    const projection = projectEvidence({ applicationId, field: "inspection", events: [{ ...input, id: "event-1", revision: 1, supersedesId: null, actorId: applicationId, occurredAt: "2026-11-09T00:00:00Z" }], documents: [], itemComplete: false });
    expect(projection).toMatchObject({ tone: "yellow", status: "upload_due", complete: false });
    expect(requirementEvidence("inspection", [projection])?.tone).toBe("yellow");
    expect(activationRequirements(facts).find((item) => item.key === "inspection")?.met).toBe(false);
  });

  it("wires every requested Next Step status to a real in-place action", () => {
    const source = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    for (const key of ["interview", "approved", "inspection", "pickup", "rental_active"]) {
      expect(source).toContain(`r.key === "${key}"`);
    }
    expect(source).toContain('docs: docsEvidenceTone');
    expect(source).toContain('profile: profileEvidenceTone');
    expect(source).toContain('agreement: agreementEvidenceTone');
    expect(source).toContain('inspection: inspectionEvidenceTone');
  });
});

describe("Pickup check-off", () => {
  it("saves a staff pickup check-off as Yellow and never as an active rental", () => {
    const applicationId = "22222222-2222-4222-8222-222222222222";
    const input = { applicationId, field: "pickup", expectedRevision: 0, idempotencyKey: applicationId, state: "collected", source: "other", note: "" } as const;
    expect(attestationInput.parse(input).field).toBe("pickup");
    const projection = projectEvidence({ applicationId, field: "pickup", events: [{ ...input, id: "event-1", revision: 1, supersedesId: null, actorId: applicationId, occurredAt: "2026-11-09T00:00:00Z" }], documents: [], itemComplete: false });
    expect(projection).toMatchObject({ tone: "yellow", status: "upload_due", complete: false });
    expect(requirementEvidence("pickup", [projection])?.tone).toBe("yellow");
    expect(activationRequirements(facts).find((item) => item.key === "rental_active")?.met).toBe(false);
    const life = driverLifecycle({ contacted: true, screening: true, documents: true, profile: true, insuranceOnFile: true, approved: true, inspection: true, agreement: true, rentalActive: false, pickup: true });
    expect(life.stages.find((s) => s.key === "pickup")?.state).toBe("done");
    expect(life.stages.find((s) => s.key === "active")?.state).toBe("current");
  });
});
